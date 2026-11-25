// NEW FILE — Lead Recycling (rules engine + queries). Touches NO existing file.
const pool = require('../config/db');
const departmentModel = require('./department.model');

// Thresholds — defaults below; can be overridden later via env WITHOUT code change.
const getConfig = () => ({
  warmDays: Number(process.env.RECYCLE_WARM_DAYS) || 7,   // Warm idle this many days -> eligible
  coldDays: Number(process.env.RECYCLE_COLD_DAYS) || 14,  // Cold idle this many days -> eligible
  deadDays: Number(process.env.RECYCLE_DEAD_DAYS) || 3,   // Dead (consultant-classified) waits this long
  maxCycles: Number(process.env.RECYCLE_MAX_CYCLES) || 2, // Cycle 2 is the last one
  batch: Number(process.env.RECYCLE_BATCH) || 50,         // max leads recycled per cron run
});

// Only ADDS columns (IF NOT EXISTS) — existing data/columns untouched. Same pattern as followup.model.js
let ready = null;
const ensureColumns = () => {
  if (!ready) {
    ready = pool
      .query(`ALTER TABLE leads
                ADD COLUMN IF NOT EXISTS cycle_no INTEGER DEFAULT 1,
                ADD COLUMN IF NOT EXISTS recycled_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS hold_until TIMESTAMP`)
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
};

// WHITELIST: only Warm / Cold / Dead can ever be recycled.
// Closed, Pending Agreement (sale/invoicing), Prospect, HOLD, New are NEVER touched.
const getCandidates = async (onlyId = null) => {
  await ensureColumns();
  const params = [];
  let idClause = '';
  if (onlyId) { params.push(onlyId); idClause = `AND l.id = $${params.length}`; }
  const r = await pool.query(
    `SELECT l.id, l.lead_name, l.contact_number, l.status, l.assigned_to,
            l.department_id, l.service_type,
            COALESCE(l.department_id,
              (SELECT d.id FROM departments d
                WHERE lower(trim(d.name)) = lower(trim(l.service_type)) LIMIT 1)
            ) AS resolved_department_id,
            COALESCE(l.cycle_no, 1) AS cycle_no, l.hold_until,
            u.name AS consultant_name,
            GREATEST(l.updated_at,
              COALESCE((SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id), l.updated_at)
            ) AS last_activity,
            EXTRACT(EPOCH FROM (NOW() - GREATEST(l.updated_at,
              COALESCE((SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id), l.updated_at)
            ))) / 86400 AS idle_days,
            EXISTS (SELECT 1 FROM lead_notes n
                    WHERE n.lead_id = l.id AND n.add_to_reminder = true
                      AND COALESCE(n.dismissed, false) = false
                      AND n.reminder_date >= CURRENT_DATE) AS has_future_followup,
            (SELECT COUNT(*) FROM lead_notes n WHERE n.lead_id = l.id)::int AS contact_attempts
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     WHERE l.status IN ('Warm','Cold','Dead')
       AND l.assigned_to IS NOT NULL
       ${idClause}
     ORDER BY l.updated_at ASC`,
    params
  );
  // No department_id and no exact name match -> reuse the EXISTING keyword rules
  // (same ones Facebook leads use). Read-only: nothing is written to the lead.
  const memo = new Map();
  for (const row of r.rows) {
    if (!row.resolved_department_id && row.service_type) {
      const key = String(row.service_type).toLowerCase();
      if (!memo.has(key)) {
        memo.set(key, await departmentModel.getDepartmentIdByKeywordMatch(row.service_type).catch(() => null));
      }
      row.resolved_department_id = memo.get(key) || null;
    }
  }
  return r.rows;
};

// ── RULES ENGINE: Eligible / Hold / Exception (or not_due) ──
const classify = (row, cfg = getConfig()) => {
  const idle = Number(row.idle_days) || 0;
  const need = row.status === 'Warm' ? cfg.warmDays : row.status === 'Cold' ? cfg.coldDays : cfg.deadDays;
  if (idle < need) return { state: 'not_due', reason: `idle ${idle.toFixed(1)}d < ${need}d` };
  if (row.hold_until && new Date(row.hold_until) > new Date()) return { state: 'hold', reason: 'approved hold active' };
  if (row.has_future_followup) return { state: 'hold', reason: 'future follow-up scheduled' };
  if (Number(row.cycle_no) >= cfg.maxCycles) return { state: 'exception', reason: `max cycles (${cfg.maxCycles}) reached` };
  if (!row.resolved_department_id) return { state: 'exception', reason: 'no department linked (set department / service type)' };
  return { state: 'eligible', reason: `idle ${idle.toFixed(1)}d >= ${need}d` };
};

// Guarded update: still Warm/Cold/Dead and below max cycles, else nothing changes.
const markRecycled = async (leadId, maxCycles) => {
  const r = await pool.query(
    `UPDATE leads
        SET cycle_no = COALESCE(cycle_no, 1) + 1,
            recycled_at = NOW(),
            hold_until = NULL,
            status = 'New',
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('Warm','Cold','Dead')
        AND COALESCE(cycle_no, 1) < $2
      RETURNING cycle_no`,
    [leadId, maxCycles]
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

module.exports = { getConfig, ensureColumns, getCandidates, classify, markRecycled, setHoldUntil };