// NEW FILE (v3) — Lead Recycling + lifecycle + trigger-matrix controller. Touches NO existing file.
// It only CALLS existing functions (pickNextStaffForDepartment, autoAssignLead,
// logAssignmentHistory, sendAssignmentWhatsapp); it does not modify them.
const recycleModel = require('../models/recycle.model');
const leadModel = require('../models/lead.model');
const departmentModel = require('../models/department.model');
const { sendAssignmentWhatsapp } = require('../services/whatsapp.service');
const { sendReminderWhatsapp } = require('../services/recycle.notify');

// Recycling = ONE controlled event: next eligible consultant in the SAME department (round-robin) -> Cycle N+1
const recycleOne = async (row, cfg) => {
  const deptId = row.resolved_department_id || null;
  if (!deptId) return { ok: false, reason: 'no department linked to this lead' };

  const staffId = await departmentModel.pickNextStaffForDepartment(deptId, row.assigned_to);
  if (!staffId) return { ok: false, reason: 'no consultant available (stays in queue)' };

  const marked = await recycleModel.markRecycled(row.id, cfg);
  if (!marked) return { ok: false, reason: 'lead changed meanwhile (skipped)' };

  await leadModel.autoAssignLead(row.id, staffId, deptId);           // also starts the normal 30-min SLA
  await leadModel.logAssignmentHistory(row.id, staffId, `recycled_cycle_${marked.cycle_no}`);
  sendAssignmentWhatsapp(row.id, staffId, `recycled_cycle_${marked.cycle_no}`).catch(() => {});
  return { ok: true, cycle_no: marked.cycle_no, staffId };
};

// GET /api/recycle/run?secret=XXX[&dry=1]   <- external cron (same style as /api/cron/sla-check)
const run = async (req, res) => {
  if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const dry = req.query.dry === '1';
  const out = {
    dry, checked: 0, eligible: 0, hold: 0, cooling: 0, exception: 0,
    recycled: 0, skipped: 0, errors: 0, reminders_due: 0, reminders_sent: 0,
  };
  try {
    const ctx = await recycleModel.getContext();
    const rows = await recycleModel.getCandidates();
    out.checked = rows.length;
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
          const r = await recycleOne(row, ctx.cfg);
          if (r.ok) { out.recycled += 1; done += 1; recycledIds.add(row.id); } else out.skipped += 1;
        } catch (e) { console.error(`[RECYCLE] lead ${row.id}:`, e); out.errors += 1; }
      }
    }
    // Reminders (Warm / Cold "no meaningful activity") — only for triggers enabled in Rules; once per lead per cycle
    for (const row of rows) {
      if (recycledIds.has(row.id)) continue;
      const kind = recycleModel.reminderDue(row, ctx);
      if (!kind) continue;
      out.reminders_due += 1;
      if (dry) continue;
      try {
        const rec = await recycleModel.recordReminder(row.id, row.cycle_no, kind, row.assigned_to, 'whatsapp');
        if (rec) {
          const days = Math.floor(Number(row.idle_days) || 0);
          await sendReminderWhatsapp(row.id, row.assigned_to, `Reminder: no activity for ${days} days - please follow up`);
          out.reminders_sent += 1;
        }
      } catch (e) { console.error(`[RECYCLE] reminder lead ${row.id}:`, e); out.errors += 1; }
    }
    console.log('[RECYCLE] run:', out);
    res.json({ success: true, ...out });
  } catch (err) {
    console.error('[RECYCLE] fatal:', err);
    res.status(500).json({ success: false, message: 'Recycle run failed' });
  }
};

const canView = (u) => u && (u.role === 'chairman' || u.role === 'mis-executive');
const isChairman = (u) => u && u.role === 'chairman';
const parseId = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const denyChairman = (res) => res.status(403).json({ success: false, message: 'Chairman only' });
// Admin override rule (Section 04): mandatory reason + logged actor
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

// GET /api/recycle/queue — everything except "not due yet"
const queue = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const ctx = await recycleModel.getContext();
    const rows = await recycleModel.getCandidates();
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

// GET /api/recycle/rules — trigger matrix (Director/Admin view)
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

// POST /api/recycle/rules/reset { department_id|null, trigger_key } (chairman only) — back to inherited/default
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

// PUT /api/recycle/:id/hold  { days | until:'YYYY-MM-DD', note }  (days = 0 clears)  — admin override: note mandatory
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
// Dead submission requires reason + outcome + notes (+ date where relevant). Validation failures are rejected.
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

// PUT /api/recycle/:id/release { note } — documented re-consent / authorized correction (reason mandatory, actor logged)
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

// POST /api/recycle/:id/recycle { note } — admin override: ONLY if rules say Eligible; recipient is always the next round-robin consultant
const recycleNow = async (req, res) => {
  if (!isChairman(req.user)) return denyChairman(res);
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const note = getNote(req, res); if (!note) return;
    const ctx = await recycleModel.getContext();
    const [row] = await recycleModel.getCandidates(id);
    if (!row) return res.status(404).json({ success: false, message: 'Lead not found, suppressed, or not Warm/Cold/Dead' });
    const c = recycleModel.classify(row, ctx);
    if (c.state !== 'eligible') return res.status(400).json({ success: false, message: `Not eligible: ${c.reason}` });
    const r = await recycleOne(row, ctx.cfg);
    if (!r.ok) return res.status(409).json({ success: false, message: r.reason });
    await logAudit(id, 'recycle_now', req, note, { cycle_no: r.cycle_no, to_staff: r.staffId });
    res.json({ success: true, cycle_no: r.cycle_no });
  } catch (err) {
    console.error('[RECYCLE] recycleNow:', err);
    res.status(500).json({ success: false, message: 'Failed to recycle lead' });
  }
};

module.exports = {
  run, queue, suppressed, lifecycle, getRules, saveRule, resetRule,
  setHold, deadReason, setDepartment, suppress, release, recycleNow,
};