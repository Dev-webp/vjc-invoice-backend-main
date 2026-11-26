// NEW FILE (v2) — Lead lifecycle + Recycling rules engine. Touches NO existing file.
// Lifecycle labels / suppression / cooling / age counters are stored in NEW columns,
// the existing `status` column and its dropdown are never changed ("map to existing labels").
const pool = require('../config/db');
const departmentModel = require('./department.model');

const getConfig = () => ({
  warmDays: Number(process.env.RECYCLE_WARM_DAYS) || 7,        // Warm: no meaningful activity for N days
  coldDays: Number(process.env.RECYCLE_COLD_DAYS) || 14,       // Cold: no meaningful activity for N days
  deadDays: Number(process.env.RECYCLE_DEAD_DAYS) || 3,        // Dead: N days in Dead status
  maxCycles: Number(process.env.RECYCLE_MAX_CYCLES) || 2,      // Cycle 2 is the last one
  coolingDays: Number(process.env.RECYCLE_COOLING_DAYS) || 3,  // after a recycle, no new recycle for N days
  minStatusDays: Number(process.env.RECYCLE_MIN_STATUS_DAYS) || 1, // never recycle same day a status was set
  batch: Number(process.env.RECYCLE_BATCH) || 50,
});

// Terminal / suppressed reasons (Section 02): never auto-recycled.
const SUPPRESS_REASONS = {
  converted: 'Converted',
  disqualified: 'Disqualified',
  do_not_contact: 'Do Not Contact',
  invalid_contact: 'Invalid Contact',
  duplicate: 'Duplicate',
  legal_consent: 'Legal / Consent Restriction',
};

// Only ADDS columns (IF NOT EXISTS). Existing columns/data untouched.
let ready = null;
const ensureColumns = () => {
  if (!ready) {
    ready = (async () => {
      await pool.query(`ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS cycle_no INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS recycled_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS hold_until TIMESTAMP,
        ADD COLUMN IF NOT EXISTS cooling_until TIMESTAMP,
        ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS suppress_reason VARCHAR(30),
        ADD COLUMN IF NOT EXISTS suppress_note VARCHAR(255),
        ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS suppressed_by INTEGER`);
      // "Time in current status": a tiny DB trigger only fills the NEW column status_changed_at
      // when `status` changes. It never alters status or any other column. Failure here is non-fatal.
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION leads_track_status_change() RETURNS trigger AS $fn$
          BEGIN
            IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.status_changed_at := NOW(); END IF;
            RETURN NEW;
          END;
          $fn$ LANGUAGE plpgsql`);
        await pool.query(`DROP TRIGGER IF EXISTS trg_leads_status_changed ON leads`);
        await pool.query(`CREATE TRIGGER trg_leads_status_changed
                          BEFORE UPDATE OF status ON leads
                          FOR EACH ROW EXECUTE FUNCTION leads_track_status_change()`);
      } catch (e) {
        console.warn('[RECYCLE] status-change trigger not installed (falls back to updated_at):', e.message);
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
};

const SELECT_SQL = `
  SELECT l.id, l.lead_name, l.contact_number, l.status, l.assigned_to,
         l.department_id, l.service_type,
         COALESCE(l.department_id,
           (SELECT d.id FROM departments d
             WHERE lower(trim(d.name)) = lower(trim(l.service_type)) LIMIT 1)
         ) AS resolved_department_id,
         COALESCE(l.cycle_no, 1) AS cycle_no,
         l.hold_until, l.cooling_until,
         l.suppress_reason, l.suppress_note, l.suppressed_at,
         u.name AS consultant_name,
         la.last_activity,
         EXTRACT(EPOCH FROM (NOW() - la.last_activity)) / 86400 AS idle_days,
         EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400 AS total_age_days,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(l.assigned_at, l.created_at))) / 86400 AS days_since_assignment,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(l.status_changed_at, l.updated_at, l.created_at))) / 86400 AS days_in_status,
         EXISTS (SELECT 1 FROM lead_notes n
                 WHERE n.lead_id = l.id AND n.add_to_reminder = true
                   AND COALESCE(n.dismissed, false) = false
                   AND n.reminder_date >= CURRENT_DATE) AS has_future_followup,
         (SELECT COUNT(*) FROM lead_notes n WHERE n.lead_id = l.id)::int AS contact_attempts
  FROM leads l
  LEFT JOIN users u ON u.id = l.assigned_to
  LEFT JOIN LATERAL (
    -- "meaningful activity" = a note/follow-up, an assignment or a recycle. Status edits do NOT count.
    SELECT GREATEST(
      COALESCE((SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id), l.created_at),
      COALESCE(l.assigned_at, l.created_at),
      COALESCE(l.recycled_at, l.created_at)
    ) AS last_activity
  ) la ON true`;

const resolveDepartments = async (rows) => {
  // No department_id and no exact name match -> reuse EXISTING keyword rules (read-only).
  const memo = new Map();
  for (const row of rows) {
    if (!row.resolved_department_id && row.service_type) {
      const key = String(row.service_type).toLowerCase();
      if (!memo.has(key)) {
        memo.set(key, await departmentModel.getDepartmentIdByKeywordMatch(row.service_type).catch(() => null));
      }
      row.resolved_department_id = memo.get(key) || null;
    }
  }
  return rows;
};

// WHITELIST: only Warm / Cold / Dead, assigned, NOT suppressed, can ever be recycled.
const getCandidates = async (onlyId = null) => {
  await ensureColumns();
  const params = [];
  let idClause = '';
  if (onlyId) { params.push(onlyId); idClause = `AND l.id = $${params.length}`; }
  const r = await pool.query(
    `${SELECT_SQL}
     WHERE l.status IN ('Warm','Cold','Dead')
       AND l.assigned_to IS NOT NULL
       AND l.suppress_reason IS NULL
       ${idClause}
     ORDER BY l.updated_at ASC`,
    params
  );
  return resolveDepartments(r.rows);
};

const getSuppressed = async () => {
  await ensureColumns();
  const r = await pool.query(`${SELECT_SQL} WHERE l.suppress_reason IS NOT NULL ORDER BY l.suppressed_at DESC NULLS LAST`);
  return r.rows;
};

const getLeadLifecycleRow = async (id) => {
  await ensureColumns();
  const r = await pool.query(`${SELECT_SQL} WHERE l.id = $1`, [id]);
  const rows = await resolveDepartments(r.rows);
  return rows[0] || null;
};

// ── RULES ENGINE: eligible / hold / cooling / exception / not_due / suppressed / not_candidate ──
const classify = (row, cfg = getConfig()) => {
  if (row.suppress_reason) return { state: 'suppressed', reason: SUPPRESS_REASONS[row.suppress_reason] || row.suppress_reason };
  if (!['Warm', 'Cold', 'Dead'].includes(row.status)) return { state: 'not_candidate', reason: `status ${row.status} is never recycled` };

  const idle = Number(row.idle_days) || 0;
  const inStatus = Number(row.days_in_status) || 0;
  let due;
  let reason;
  if (row.status === 'Dead') {
    due = inStatus >= cfg.deadDays;
    reason = `in Dead ${inStatus.toFixed(1)}d ${due ? '>=' : '<'} ${cfg.deadDays}d`;
  } else {
    const need = row.status === 'Warm' ? cfg.warmDays : cfg.coldDays;
    due = idle >= need && inStatus >= cfg.minStatusDays;
    reason = `no activity ${idle.toFixed(1)}d ${idle >= need ? '>=' : '<'} ${need}d`;
  }
  if (!due) return { state: 'not_due', reason };
  if (row.cooling_until && new Date(row.cooling_until) > new Date()) {
    return { state: 'cooling', reason: `cooling period until ${new Date(row.cooling_until).toLocaleDateString('en-GB')}` };
  }
  if (row.hold_until && new Date(row.hold_until) > new Date()) return { state: 'hold', reason: 'approved hold active' };
  if (row.has_future_followup) return { state: 'hold', reason: 'future follow-up scheduled' };
  if (Number(row.cycle_no) >= cfg.maxCycles) return { state: 'exception', reason: `max cycles (${cfg.maxCycles}) reached` };
  if (!row.resolved_department_id) return { state: 'exception', reason: 'no department linked (set department / service type)' };
  return { state: 'eligible', reason };
};

// Section 02 "Ownership state" — derived from stored fields, so it is never stale.
const ownershipState = (row, c) => {
  if (row.suppress_reason || row.status === 'Closed') return 'Closed';
  if (c.state === 'cooling') return 'Cooling Period';
  if (c.state === 'eligible') return 'Auto-Recycle Pending';
  if (c.state === 'exception') return 'Manual Exception Review';
  if (Number(row.cycle_no) > 1) return 'Recycled/Reassigned';
  return 'Assigned';
};

// Section 02 "Lead status" — maps new labels onto the EXISTING status (no new status values written).
const lifecycleStatus = (row) => {
  if (row.suppress_reason) return SUPPRESS_REASONS[row.suppress_reason] || row.suppress_reason;
  if (row.status === 'New' && Number(row.contact_attempts) > 0) return 'Attempting Contact';
  return row.status;
};

const decorate = (row, cfg = getConfig()) => {
  const c = classify(row, cfg);
  const d = (v) => Math.floor(Number(v) || 0);
  return {
    ...row,
    ...c,
    ownership_state: ownershipState(row, c),
    lifecycle_status: lifecycleStatus(row),
    total_age_days: d(row.total_age_days),
    idle_days: d(row.idle_days),
    days_in_status: d(row.days_in_status),
    days_since_assignment: d(row.days_since_assignment),
  };
};

// Guarded update: still Warm/Cold/Dead, not suppressed, below max cycles — else nothing changes.
const markRecycled = async (leadId, cfg) => {
  const r = await pool.query(
    `UPDATE leads
        SET cycle_no = COALESCE(cycle_no, 1) + 1,
            recycled_at = NOW(),
            cooling_until = NOW() + ($3::int * INTERVAL '1 day'),
            hold_until = NULL,
            status = 'New',
            status_changed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('Warm','Cold','Dead')
        AND suppress_reason IS NULL
        AND COALESCE(cycle_no, 1) < $2
      RETURNING cycle_no`,
    [leadId, cfg.maxCycles, cfg.coolingDays]
  );
  return r.rows[0] || null;
};

const setHoldUntil = async (leadId, days) => {
  await ensureColumns();
  const r = await pool.query(
    `UPDATE leads
        SET hold_until = CASE WHEN $2::int > 0 THEN NOW() + ($2::int * INTERVAL '1 day') ELSE NULL END
      WHERE id = $1 AND status IN ('Warm','Cold','Dead')
      RETURNING id, hold_until`,
    [leadId, days]
  );
  return r.rows[0] || null;
};

const suppressLead = async (leadId, reason, note, userId) => {
  await ensureColumns();
  if (!SUPPRESS_REASONS[reason]) return null;
  const r = await pool.query(
    `UPDATE leads
        SET suppress_reason = $2, suppress_note = $3, suppressed_at = NOW(), suppressed_by = $4
      WHERE id = $1
      RETURNING id, suppress_reason`,
    [leadId, reason, (note || '').slice(0, 255) || null, userId || null]
  );
  return r.rows[0] || null;
};

const releaseSuppression = async (leadId) => {
  await ensureColumns();
  const r = await pool.query(
    `UPDATE leads
        SET suppress_reason = NULL, suppress_note = NULL, suppressed_at = NULL, suppressed_by = NULL
      WHERE id = $1 AND suppress_reason IS NOT NULL
      RETURNING id`,
    [leadId]
  );
  return r.rows[0] || null;
};

module.exports = {
  SUPPRESS_REASONS, getConfig, ensureColumns, getCandidates, getSuppressed, getLeadLifecycleRow,
  classify, ownershipState, lifecycleStatus, decorate, markRecycled, setHoldUntil, suppressLead, releaseSuppression,
};