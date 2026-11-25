// NEW FILE — Lead Recycling controller. Touches NO existing file.
// It only CALLS existing functions (pickNextStaffForDepartment, autoAssignLead,
// logAssignmentHistory, sendAssignmentWhatsapp); it does not modify them.
const recycleModel = require('../models/recycle.model');
const leadModel = require('../models/lead.model');
const departmentModel = require('../models/department.model');
const { sendAssignmentWhatsapp } = require('../services/whatsapp.service');

// Recycling = ONE controlled event: next eligible consultant (round-robin, skipping the old one) -> Cycle N+1
const recycleOne = async (row, cfg) => {
  let deptId = row.department_id || null;
  if (!deptId && row.service_type) deptId = await departmentModel.getDepartmentIdByServiceType(row.service_type);
  if (!deptId) return { ok: false, reason: 'no department' };

  const staffId = await departmentModel.pickNextStaffForDepartment(deptId, row.assigned_to);
  if (!staffId) return { ok: false, reason: 'no consultant available (stays in queue)' };

  const marked = await recycleModel.markRecycled(row.id, cfg.maxCycles);
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
  const out = { dry, checked: 0, eligible: 0, hold: 0, exception: 0, recycled: 0, skipped: 0, errors: 0 };
  try {
    const rows = await recycleModel.getCandidates();
    out.checked = rows.length;
    let done = 0;
    for (const row of rows) {
      const c = recycleModel.classify(row, cfg);
      if (c.state === 'hold') out.hold += 1;
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

// GET /api/recycle/queue — Recycling Queue tab (hold / exception / eligible only)
const queue = async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ success: false, message: 'Not allowed' });
  try {
    const cfg = recycleModel.getConfig();
    const rows = await recycleModel.getCandidates();
    const items = rows
      .map((r) => ({ ...r, ...recycleModel.classify(r, cfg) }))
      .filter((r) => r.state !== 'not_due')
      .map((r) => ({ ...r, idle_days: Math.floor(Number(r.idle_days) || 0) }));
    res.json({ success: true, config: cfg, items });
  } catch (err) {
    console.error('[RECYCLE] queue:', err);
    res.status(500).json({ success: false, message: 'Failed to load queue' });
  }
};

// PUT /api/recycle/:id/hold  { days }  (chairman only; days = 0 clears the hold)
const setHold = async (req, res) => {
  if (req.user?.role !== 'chairman') return res.status(403).json({ success: false, message: 'Chairman only' });
  try {
    const id = Number(req.params.id);
    const days = Math.max(0, Math.min(365, Number(req.body.days) || 0));
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const r = await recycleModel.setHoldUntil(id, days);
    if (!r) return res.status(404).json({ success: false, message: 'Lead not found or not Warm/Cold/Dead' });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[RECYCLE] hold:', err);
    res.status(500).json({ success: false, message: 'Failed to set hold' });
  }
};

// POST /api/recycle/:id/recycle — chairman manually fires the event, ONLY if rules say Eligible
const recycleNow = async (req, res) => {
  if (req.user?.role !== 'chairman') return res.status(403).json({ success: false, message: 'Chairman only' });
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const cfg = recycleModel.getConfig();
    const [row] = await recycleModel.getCandidates(id);
    if (!row) return res.status(404).json({ success: false, message: 'Lead not found or not Warm/Cold/Dead' });
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

module.exports = { run, queue, setHold, recycleNow };