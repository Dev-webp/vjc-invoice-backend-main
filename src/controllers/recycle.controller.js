// NEW FILE (v2) — Lead Recycling + lifecycle controller. Touches NO existing file.
// It only CALLS existing functions (pickNextStaffForDepartment, autoAssignLead,
// logAssignmentHistory, sendAssignmentWhatsapp); it does not modify them.
const recycleModel = require('../models/recycle.model');
const leadModel = require('../models/lead.model');
const departmentModel = require('../models/department.model');
const { sendAssignmentWhatsapp } = require('../services/whatsapp.service');

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
  const cfg = recycleModel.getConfig();
  const out = { dry, checked: 0, eligible: 0, hold: 0, cooling: 0, exception: 0, recycled: 0, skipped: 0, errors: 0 };
  try {
    const rows = await recycleModel.getCandidates();
    out.checked = rows.length;
    let done = 0;
    for (const row of rows) {
      const c = recycleModel.classify(row, cfg);
      if (c.state === 'hold') out.hold += 1;
      else if (c.state === 'cooling') out.cooling += 1;
      else if (c.state === 'exception') out.exception += 1;
      else if (c.state === 'eligible') {
        out.eligible += 1;
        if (dry || done >= cfg.batch) continue;
        try {
          const r = await recycleOne(row, cfg);
          if (r.ok) { out.recycled += 1; done += 1; } else out.skipped += 1;
        } catch (e) { console.error(`[RECYCLE] lead ${row.id}:`, e); out.errors += 1; }
      }
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

// GET /api/recycle/queue — everything except "not due yet"
const queue = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const cfg = recycleModel.getConfig();
    const rows = await recycleModel.getCandidates();
    const items = rows.map((r) => recycleModel.decorate(r, cfg)).filter((r) => r.state !== 'not_due');
    res.json({ success: true, config: cfg, items });
  } catch (err) {
    console.error('[RECYCLE] queue:', err);
    res.status(500).json({ success: false, message: 'Failed to load queue' });
  }
};

// GET /api/recycle/suppressed — Converted / Disqualified / DNC / Invalid / Duplicate / Legal
const suppressed = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const rows = await recycleModel.getSuppressed();
    res.json({ success: true, reasons: recycleModel.SUPPRESS_REASONS, items: rows.map((r) => recycleModel.decorate(r)) });
  } catch (err) {
    console.error('[RECYCLE] suppressed:', err);
    res.status(500).json({ success: false, message: 'Failed to load suppressed leads' });
  }
};

// GET /api/recycle/lead/:id/lifecycle — lifecycle status, ownership state, cycle and age counters for ANY lead
const lifecycle = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const row = await recycleModel.getLeadLifecycleRow(id);
    if (!row) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, lifecycle: recycleModel.decorate(row) });
  } catch (err) {
    console.error('[RECYCLE] lifecycle:', err);
    res.status(500).json({ success: false, message: 'Failed to load lifecycle' });
  }
};

// PUT /api/recycle/:id/hold  { days }  (chairman only; days = 0 clears the hold)
const setHold = async (req, res) => {
  if (!isChairman(req.user)) return res.status(403).json({ success: false, message: 'Chairman only' });
  try {
    const id = parseId(req.params.id);
    const days = Math.max(0, Math.min(365, Number(req.body.days) || 0));
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const r = await recycleModel.setHoldUntil(id, days);
    if (!r) return res.status(404).json({ success: false, message: 'Lead not found or not Warm/Cold/Dead' });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[RECYCLE] hold:', err);
    res.status(500).json({ success: false, message: 'Failed to set hold' });
  }
};

// PUT /api/recycle/:id/suppress { reason, note }  (chairman only) — stops ALL automatic recycling for this lead
const suppress = async (req, res) => {
  if (!isChairman(req.user)) return res.status(403).json({ success: false, message: 'Chairman only' });
  try {
    const id = parseId(req.params.id);
    const { reason, note } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    if (!recycleModel.SUPPRESS_REASONS[reason]) return res.status(400).json({ success: false, message: 'Invalid reason' });
    const r = await recycleModel.suppressLead(id, reason, note, req.user.id);
    if (!r) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[RECYCLE] suppress:', err);
    res.status(500).json({ success: false, message: 'Failed to suppress lead' });
  }
};

// PUT /api/recycle/:id/release (chairman only) — lead can be considered for recycling again
const release = async (req, res) => {
  if (!isChairman(req.user)) return res.status(403).json({ success: false, message: 'Chairman only' });
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const r = await recycleModel.releaseSuppression(id);
    if (!r) return res.status(404).json({ success: false, message: 'Lead not found or not suppressed' });
    res.json({ success: true, id: r.id });
  } catch (err) {
    console.error('[RECYCLE] release:', err);
    res.status(500).json({ success: false, message: 'Failed to release lead' });
  }
};

// POST /api/recycle/:id/recycle — chairman manually fires the event, ONLY if rules say Eligible
const recycleNow = async (req, res) => {
  if (!isChairman(req.user)) return res.status(403).json({ success: false, message: 'Chairman only' });
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const cfg = recycleModel.getConfig();
    const [row] = await recycleModel.getCandidates(id);
    if (!row) return res.status(404).json({ success: false, message: 'Lead not found, suppressed, or not Warm/Cold/Dead' });
    const c = recycleModel.classify(row, cfg);
    if (c.state !== 'eligible') return res.status(400).json({ success: false, message: `Not eligible: ${c.reason}` });
    const r = await recycleOne(row, cfg);
    if (!r.ok) return res.status(409).json({ success: false, message: r.reason });
    res.json({ success: true, cycle_no: r.cycle_no });
  } catch (err) {
    console.error('[RECYCLE] recycleNow:', err);
    res.status(500).json({ success: false, message: 'Failed to recycle lead' });
  }
};

module.exports = { run, queue, suppressed, lifecycle, setHold, suppress, release, recycleNow };