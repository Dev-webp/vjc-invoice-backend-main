// NEW FILE (v5) — Lead Recycling controller. Touches NO existing file.
// Calls NO existing code and NO WhatsApp: all alerts are in-system notifications (recycle_notifications).
const recycleModel = require('../models/recycle.model');

// Recycling = ONE controlled, transactional event. Recipient is ALWAYS chosen by the per-team round-robin cursor.
const recycleOne = async (row, ctx, routing, actor) => {
  const deptId = row.resolved_department_id || null;
  if (!deptId) return { ok: false, reason: 'no department linked to this lead' };
  const maxCycles = recycleModel.ruleFor(ctx.rules, deptId, 'max_cycles').value;
  const cap = recycleModel.ruleFor(ctx.rules, deptId, 'consultant_capacity');
  const res = await recycleModel.recycleLeadTx(row.id, {
    deptId, maxCycles, coolingDays: ctx.cfg.coolingDays, fromCycle: Number(row.cycle_no),
    capacity: cap.enabled ? cap.value : null, routing, actorId: actor?.id || null,
  });
  if (res.ok && !res.duplicate) {
    // Section 08: neutral wording for the new consultant (no "recycled" / "Dead" label)
    await recycleModel.notify(res.staffId, row.id, 'recycled_to_you',
      `Assigned Lead: "${row.lead_name}" has been assigned to you. Open "Brief" in Log Attempt for the customer details. First contact is due within 30 minutes.`).catch(() => {});
  }
  return res;
};

const BLOCKED_TEXT = 'No other eligible consultant in this team/service - Admin notified, lead stays in the pending queue';

const notifyAdmins = async (row, ctx, dry) => {
  const t = recycleModel.ruleFor(ctx.rules, null, 'notify_admin_no_consultant');
  if (!t.enabled || dry) return 0;
  const first = await recycleModel.recordReminder(row.id, row.cycle_no, 'admin_no_consultant', null, 'in_system');
  if (!first) return 0;                                  // once per lead per cycle
  let sent = 0;
  const admins = await recycleModel.getAdminIds().catch(() => []);
  for (const adminId of admins) {
    await recycleModel.notify(adminId, row.id, 'admin_no_consultant',
      `Recycle blocked for "${row.lead_name}": no other eligible consultant is available in its team/service. Please review.`).catch(() => {});
    sent += 1;
  }
  return sent;
};

// Section 07: failure alert to every admin (in-system), once per lead/cycle or once while unread
const alertFailure = async (kind, row, message) => {
  const admins = await recycleModel.getAdminIds().catch(() => []);
  for (const adminId of admins) {
    await recycleModel.notifyOnce(adminId, row ? row.id : null, kind, message).catch(() => {});
  }
};

// GET /api/recycle/run?secret=XXX[&dry=1]   <- external cron (same style as /api/cron/sla-check)
const run = async (req, res) => {
  if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const dry = req.query.dry === '1';
  const out = {
    dry, checked: 0, queued: 0, eligible: 0, hold: 0, cooling: 0, exception: 0,
    recycled: 0, no_consultant: 0, skipped: 0, errors: 0, reminders_due: 0, reminders_sent: 0,
  };
  let runId = null;
  try {
    runId = await recycleModel.startRun(dry);
    const ctx = await recycleModel.getContext();
    const rows = await recycleModel.getCandidates(null, ctx.rules);
    out.checked = rows.length;
    if (!dry) out.queued = await recycleModel.evaluateAll(ctx);      // single idempotent evaluation path
    let done = 0;
    const recycledIds = new Set();
    for (const row of rows) {
      const c = recycleModel.classify(row, ctx);
      if (c.state === 'hold') out.hold += 1;
      else if (c.state === 'cooling') out.cooling += 1;
      else if (c.state === 'exception') out.exception += 1;
      else if (c.state === 'eligible') {
        out.eligible += 1;
        if (dry || done >= ctx.cfg.batch) continue;
        try {
          const r = await recycleOne(row, ctx, 'auto_cron', null);
          if (r.ok) { out.recycled += 1; done += 1; recycledIds.add(row.id); }
          else if (r.noConsultant) {
            out.no_consultant += 1;
            await recycleModel.markBlocked(row.id, row.cycle_no, BLOCKED_TEXT);
            await notifyAdmins(row, ctx, dry);
          } else out.skipped += 1;
        } catch (e) {
          console.error(`[RECYCLE] lead ${row.id}:`, e);
          out.errors += 1;
          await recycleModel.recordError(row.id, row.cycle_no, 'recycle', e.message).catch(() => {});
          await alertFailure('recycle_failed', row, `Recycling failed for "${row.lead_name}" after retries: ${e.message}`);
        }
      }
    }
    for (const row of rows) {
      if (recycledIds.has(row.id)) continue;
      const kind = recycleModel.reminderDue(row, ctx);
      if (!kind) continue;
      out.reminders_due += 1;
      if (dry) continue;
      try {
        const rec = await recycleModel.recordReminder(row.id, row.cycle_no, kind, row.assigned_to, 'in_system');
        if (rec) {
          const days = Math.floor(Number(row.idle_days) || 0);
          await recycleModel.notify(row.assigned_to, row.id, kind,
            `Follow-up warning: no meaningful activity on "${row.lead_name}" for ${days} days. Please contact the customer and log the attempt.`);
          out.reminders_sent += 1;
        }
      } catch (e) { console.error(`[RECYCLE] reminder lead ${row.id}:`, e); out.errors += 1; }
    }
    console.log('[RECYCLE] run:', out);
    if (runId) await recycleModel.finishRun(runId, out, null).catch(() => {});
    res.json({ success: true, ...out });
  } catch (err) {
    console.error('[RECYCLE] fatal:', err);
    await recycleModel.recordError(null, null, 'run', err.message).catch(() => {});
    if (runId) await recycleModel.finishRun(runId, out, err.message).catch(() => {});
    await alertFailure('run_failed', null, `Recycling run failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Recycle run failed' });
  }
};

const canView = (u) => u && (u.role === 'chairman' || u.role === 'mis-executive');
const isChairman = (u) => u && u.role === 'chairman';
const parseId = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const denyChairman = (res) => res.status(403).json({ success: false, message: 'Chairman only' });
const getNote = (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 3) {
    res.status(400).json({ success: false, message: 'A reason / note is mandatory for this action (min 3 characters)' });
    return null;
  }
  return note;
};
const logAudit = async (leadId, action, req, note, details) => {
  try { await recycleModel.audit(leadId, action, req.user, note, details); }
  catch (e) { console.error('[RECYCLE] audit log failed:', e.message); }
};

// GET /api/recycle/queue
const queue = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const ctx = await recycleModel.getContext();
    const rows = await recycleModel.getCandidates(null, ctx.rules);
    const items = rows.map((r) => recycleModel.decorate(r, ctx)).filter((r) => r.state !== 'not_due');
    const { departments } = await recycleModel.getRulesPayload();
    res.json({ success: true, config: ctx.cfg, departments, items });
  } catch (err) {
    console.error('[RECYCLE] queue:', err);
    res.status(500).json({ success: false, message: 'Failed to load queue' });
  }
};

// GET /api/recycle/suppressed
const suppressed = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const ctx = await recycleModel.getContext();
    const rows = await recycleModel.getSuppressed();
    res.json({ success: true, reasons: recycleModel.SUPPRESS_REASONS, items: rows.map((r) => recycleModel.decorate(r, ctx)) });
  } catch (err) {
    console.error('[RECYCLE] suppressed:', err);
    res.status(500).json({ success: false, message: 'Failed to load suppressed leads' });
  }
};

// GET /api/recycle/lead/:id/lifecycle
const lifecycle = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const row = await recycleModel.getLeadLifecycleRow(id);
    if (!row) return res.status(404).json({ success: false, message: 'Lead not found' });
    const ctx = await recycleModel.getContext();
    res.json({ success: true, lifecycle: recycleModel.decorate(row, ctx) });
  } catch (err) {
    console.error('[RECYCLE] lifecycle:', err);
    res.status(500).json({ success: false, message: 'Failed to load lifecycle' });
  }
};

// GET /api/recycle/rules
const getRules = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    res.json({ success: true, ...(await recycleModel.getRulesPayload()) });
  } catch (err) {
    console.error('[RECYCLE] getRules:', err);
    res.status(500).json({ success: false, message: 'Failed to load rules' });
  }
};

// PUT /api/recycle/rules { department_id|null, trigger_key, enabled, value } (chairman only)
const saveRule = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const { department_id, trigger_key, enabled, value } = req.body || {};
    const dep = department_id === null || department_id === undefined || department_id === '' ? null : parseId(department_id);
    if (department_id && !dep) return res.status(400).json({ success: false, message: 'Invalid department' });
    const r = await recycleModel.saveRule(dep, trigger_key, enabled, value, req.user.id);
    if (!r) return res.status(400).json({ success: false, message: 'Invalid trigger' });
    res.json({ success: true, rule: r });
  } catch (err) {
    console.error('[RECYCLE] saveRule:', err);
    res.status(500).json({ success: false, message: 'Failed to save rule' });
  }
};

// POST /api/recycle/rules/reset { department_id|null, trigger_key } (chairman only)
const resetRule = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const { department_id, trigger_key } = req.body || {};
    const dep = department_id === null || department_id === undefined || department_id === '' ? null : parseId(department_id);
    await recycleModel.resetRule(dep, trigger_key);
    res.json({ success: true });
  } catch (err) {
    console.error('[RECYCLE] resetRule:', err);
    res.status(500).json({ success: false, message: 'Failed to reset rule' });
  }
};

// PUT /api/recycle/:id/hold  { days | until:'YYYY-MM-DD', note }  (days = 0 clears)
const setHold = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const note = getNote(req, res); if (!note) return;
    const { days, until } = req.body || {};
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return res.status(400).json({ success: false, message: 'Date must be YYYY-MM-DD' });
    const r = await recycleModel.setHold(id, { days, until });
    if (!r) return res.status(404).json({ success: false, message: 'Lead not found or not Warm/Cold/Dead' });
    await logAudit(id, r.hold_until ? 'hold' : 'hold_release', req, note, { days: days || null, until: until || null });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[RECYCLE] hold:', err);
    res.status(500).json({ success: false, message: 'Failed to set hold' });
  }
};

// PUT /api/recycle/:id/dead-reason { reason, outcome, note, date?, duplicate_of? }
// Evaluated immediately after a Dead submission (same single evaluation path as the scheduled job).
const deadReason = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const { reason, outcome, date, duplicate_of } = req.body || {};
    if (!recycleModel.DEAD_REASONS[reason]) return res.status(400).json({ success: false, message: 'Invalid reason' });
    const note = getNote(req, res); if (!note) return;
    if (String(outcome || '').trim().length < 2) return res.status(400).json({ success: false, message: 'Outcome is mandatory' });
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: 'Date must be YYYY-MM-DD' });
    const r = await recycleModel.setDeadReason(id, {
      reason, outcome: String(outcome).trim(), notes: note, date, duplicateOf: duplicate_of, actorId: req.user.id,
    });
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    await logAudit(id, 'dead_reason', req, note, { reason, outcome, date: date || null, duplicate_of: duplicate_of || null, suppressed: r.row.suppress_reason || null });
    try { await recycleModel.evaluateOne(id); } catch (e) { console.error('[RECYCLE] evaluate on Dead submission failed:', e.message); }
    res.json({ success: true, ...r.row });
  } catch (err) {
    console.error('[RECYCLE] deadReason:', err);
    res.status(500).json({ success: false, message: 'Failed to set dead reason' });
  }
};

// PUT /api/recycle/:id/department { department_id, note } — only fills an EMPTY department
const setDepartment = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    const dep = parseId(req.body?.department_id);
    if (!id || !dep) return res.status(400).json({ success: false, message: 'Invalid lead / department' });
    const note = getNote(req, res); if (!note) return;
    const r = await recycleModel.setDepartment(id, dep);
    if (!r) return res.status(409).json({ success: false, message: 'Lead already has a department, or department not found' });
    await logAudit(id, 'set_department', req, note, { department_id: dep });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[RECYCLE] setDepartment:', err);
    res.status(500).json({ success: false, message: 'Failed to set department' });
  }
};

// PUT /api/recycle/:id/suppress { reason, note, duplicate_of? }
const suppress = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    const { reason, duplicate_of } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    if (!recycleModel.SUPPRESS_REASONS[reason]) return res.status(400).json({ success: false, message: 'Invalid reason' });
    const note = getNote(req, res); if (!note) return;
    const r = await recycleModel.suppressLead(id, reason, note, req.user.id, duplicate_of);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    await logAudit(id, 'suppress', req, note, { reason, duplicate_of: duplicate_of || null });
    res.json({ success: true, ...r.row });
  } catch (err) {
    console.error('[RECYCLE] suppress:', err);
    res.status(500).json({ success: false, message: 'Failed to suppress lead' });
  }
};

// PUT /api/recycle/:id/release { note }
const release = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const note = getNote(req, res); if (!note) return;
    const r = await recycleModel.releaseSuppression(id);
    if (!r) return res.status(404).json({ success: false, message: 'Lead not found or not suppressed' });
    await logAudit(id, 'release_suppression', req, note, null);
    res.json({ success: true, id: r.id });
  } catch (err) {
    console.error('[RECYCLE] release:', err);
    res.status(500).json({ success: false, message: 'Failed to release lead' });
  }
};

// POST /api/recycle/:id/recycle { note } — admin override: only if rules say Eligible; recipient = next in cursor
const recycleNow = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const note = getNote(req, res); if (!note) return;
    const ctx = await recycleModel.getContext();
    const [row] = await recycleModel.getCandidates(id, ctx.rules);
    if (!row) return res.status(404).json({ success: false, message: 'Lead not found, suppressed, or not Warm/Cold/Dead' });
    const c = recycleModel.classify(row, ctx);
    if (c.state !== 'eligible') return res.status(400).json({ success: false, message: `Not eligible: ${c.reason}` });
    const r = await recycleOne(row, ctx, 'admin_override', req.user);
    if (!r.ok) {
      if (r.noConsultant) await recycleModel.markBlocked(row.id, row.cycle_no, BLOCKED_TEXT);
      return res.status(409).json({ success: false, message: r.reason });
    }
    await logAudit(id, 'recycle_now', req, note, { cycle_no: r.cycle_no, to_staff: r.staffId, from_staff: r.oldOwner });
    res.json({ success: true, cycle_no: r.cycle_no });
  } catch (err) {
    console.error('[RECYCLE] recycleNow:', err);
    res.status(500).json({ success: false, message: 'Failed to recycle lead' });
  }
};

// ── Section 05: contact attempt log (consultants log on their OWN leads) ──
// POST /api/recycle/:id/attempt
const logAttempt = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const r = await recycleModel.createAttempt(id, req.user, req.body || {});
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, attempt: r.row });
  } catch (err) {
    console.error('[RECYCLE] logAttempt:', err);
    res.status(500).json({ success: false, message: 'Failed to log attempt' });
  }
};

// GET /api/recycle/:id/attempts — attempt history + follow-up reschedule history
const attempts = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const lead = await recycleModel.getLeadOwner(id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canView(req.user) && Number(lead.assigned_to) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    res.json({ success: true, lead: { id: lead.id, lead_name: lead.lead_name }, ...(await recycleModel.listAttempts(id)) });
  } catch (err) {
    console.error('[RECYCLE] attempts:', err);
    res.status(500).json({ success: false, message: 'Failed to load attempts' });
  }
};

// GET /api/recycle/my-leads — leads assigned to the logged-in consultant
const myLeads = async (req, res) => {
  try {
    res.json({ success: true, channels: recycleModel.CHANNELS, outcomes: recycleModel.OUTCOMES, items: await recycleModel.myLeads(req.user.id) });
  } catch (err) {
    console.error('[RECYCLE] myLeads:', err);
    res.status(500).json({ success: false, message: 'Failed to load your leads' });
  }
};

// GET /api/recycle/notifications — the logged-in user's in-system notifications
const notifications = async (req, res) => {
  try {
    res.json({ success: true, ...(await recycleModel.listNotifications(req.user.id)) });
  } catch (err) {
    console.error('[RECYCLE] notifications:', err);
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
};

// POST /api/recycle/notifications/read { ids?: [] }  (no ids = mark all read)
const readNotifications = async (req, res) => {
  try {
    await recycleModel.markNotificationsRead(req.user.id, req.body?.ids);
    res.json({ success: true });
  } catch (err) {
    console.error('[RECYCLE] readNotifications:', err);
    res.status(500).json({ success: false, message: 'Failed to update notifications' });
  }
};

// GET /api/recycle/:id/brief — what the NEW consultant sees (neutral; assigned consultant or admin/MIS)
const brief = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const lead = await recycleModel.getLeadOwner(id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canView(req.user) && Number(lead.assigned_to) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    res.json({ success: true, brief: await recycleModel.getBrief(id) });
  } catch (err) {
    console.error('[RECYCLE] brief:', err);
    res.status(500).json({ success: false, message: 'Failed to load lead brief' });
  }
};

// GET /api/recycle/:id/timeline — Director/Admin full event timeline
const timeline = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const t = await recycleModel.getTimeline(id);
    if (!t) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, ...t });
  } catch (err) {
    console.error('[RECYCLE] timeline:', err);
    res.status(500).json({ success: false, message: 'Failed to load timeline' });
  }
};

// GET /api/recycle/health — queue / run monitoring
const health = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    res.json({ success: true, ...(await recycleModel.getHealth()) });
  } catch (err) {
    console.error('[RECYCLE] health:', err);
    res.status(500).json({ success: false, message: 'Failed to load health' });
  }
};

// GET /api/recycle/analytics — manager flags (patterns only, never an accusation)
const analytics = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    res.json({ success: true, ...(await recycleModel.getAnalytics()) });
  } catch (err) {
    console.error('[RECYCLE] analytics:', err);
    res.status(500).json({ success: false, message: 'Failed to load analytics' });
  }
};

module.exports = {
  run, queue, suppressed, lifecycle, getRules, saveRule, resetRule,
  setHold, deadReason, setDepartment, suppress, release, recycleNow,
  logAttempt, attempts, myLeads, analytics, notifications, readNotifications, brief, timeline, health,
};