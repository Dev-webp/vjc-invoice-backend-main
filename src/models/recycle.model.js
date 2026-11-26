// NEW FILE (v3) — Lead lifecycle + Recycling rules engine + configurable trigger matrix. Touches NO existing file.
const pool = require('../config/db');
const departmentModel = require('./department.model');

// Not part of the trigger matrix -> stay env-based
const getConfig = () => ({
  maxCycles: Number(process.env.RECYCLE_MAX_CYCLES) || 2,
  coolingDays: Number(process.env.RECYCLE_COOLING_DAYS) || 3,
  minStatusDays: Number(process.env.RECYCLE_MIN_STATUS_DAYS) || 1,
  batch: Number(process.env.RECYCLE_BATCH) || 50,
});

const SUPPRESS_REASONS = {
  converted: 'Converted',
  disqualified: 'Disqualified',
  do_not_contact: 'Do Not Contact',
  invalid_contact: 'Invalid Contact',
  duplicate: 'Duplicate',
  legal_consent: 'Legal / Consent Restriction',
};
const DEAD_REASONS = {
  not_reachable: 'Not Reachable',
  no_response: 'No Response / Follow-up Missed',
  budget: 'Budget / Not Now',
  timing: 'Timing',
  not_interested: 'Not Interested',
  wrong_number: 'Wrong Number / Invalid',
  duplicate: 'Duplicate',
  not_eligible: 'Not Eligible / Service Not Offered',
  do_not_contact: 'Do Not Contact / Opt-out',
};
// reasons that are suppressed automatically the moment they are recorded
const AUTO_SUPPRESS = { wrong_number: 'invalid_contact', duplicate: 'duplicate', do_not_contact: 'do_not_contact' };

// ── Section 03 trigger matrix: suggested defaults (Director/Admin can override globally or per department) ──
const TRIGGERS = [
  { key: 'warm_reminder', label: 'Warm: no meaningful activity → reminder', unit: 'calendar days' },
  { key: 'warm_recycle', label: 'Warm: still no progress → auto-recycle', unit: 'calendar days' },
  { key: 'cold_reminder', label: 'Cold: no meaningful activity → reminder', unit: 'calendar days' },
  { key: 'cold_recycle', label: 'Cold: still no progress → auto-recycle', unit: 'calendar days' },
  { key: 'dead_not_reachable', label: 'Dead (Not Reachable / No Response): cooldown, then queue & reassign', unit: 'calendar days in Dead' },
  { key: 'dead_min_attempts', label: 'Dead (Not Reachable / No Response): minimum attempts on distinct days', unit: 'distinct days' },
  { key: 'dead_budget_timing', label: 'Dead (Budget / Not Now / Timing): recycle after customer date', unit: 'on / off' },
];
const getDefaults = () => ({
  warm_reminder: { enabled: false, value: 3 },   // OFF until the reminder message wording is verified
  warm_recycle: { enabled: true, value: Number(process.env.RECYCLE_WARM_DAYS) || 7 },
  cold_reminder: { enabled: false, value: 7 },
  cold_recycle: { enabled: true, value: Number(process.env.RECYCLE_COLD_DAYS) || 14 },
  dead_not_reachable: { enabled: true, value: Number(process.env.RECYCLE_DEAD_DAYS) || 3 },
  dead_min_attempts: { enabled: true, value: 3 },
  dead_budget_timing: { enabled: true, value: 0 },
});

// Only ADDS columns / tables (IF NOT EXISTS). Existing columns/data untouched.
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
        ADD COLUMN IF NOT EXISTS suppressed_by INTEGER,
        ADD COLUMN IF NOT EXISTS dead_reason VARCHAR(20),
        ADD COLUMN IF NOT EXISTS dead_outcome VARCHAR(120),
        ADD COLUMN IF NOT EXISTS dead_notes VARCHAR(255),
        ADD COLUMN IF NOT EXISTS duplicate_of INTEGER`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_audit (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL,
        action VARCHAR(30) NOT NULL,
        actor_id INTEGER,
        actor_role VARCHAR(30),
        reason TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS recycle_audit_lead_idx ON recycle_audit (lead_id)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_rules (
        id SERIAL PRIMARY KEY,
        department_id INTEGER,
        trigger_key VARCHAR(40) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        value INTEGER NOT NULL DEFAULT 0,
        updated_by INTEGER,
        updated_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS recycle_rules_uq
                        ON recycle_rules ((COALESCE(department_id, 0)), trigger_key)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_reminders (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL,
        cycle_no INTEGER NOT NULL DEFAULT 1,
        kind VARCHAR(30) NOT NULL,
        user_id INTEGER,
        channel VARCHAR(20),
        sent_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (lead_id, cycle_no, kind))`);
      // "Time in current status": tiny trigger that only fills the NEW column status_changed_at. Non-fatal if it fails.
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

// ── Rules (per department override -> global row -> built-in default) ──
const loadRules = async () => {
  await ensureColumns();
  const r = await pool.query(`SELECT department_id, trigger_key, enabled, value FROM recycle_rules`);
  const map = new Map();
  r.rows.forEach((x) => map.set(`${x.department_id || 0}:${x.trigger_key}`, { enabled: x.enabled, value: Number(x.value) }));
  return map;
};
const ruleFor = (rules, deptId, key) =>
  (deptId && rules.get(`${deptId}:${key}`)) || rules.get(`0:${key}`) || getDefaults()[key];

const getContext = async () => ({ cfg: getConfig(), rules: await loadRules() });

const getRulesPayload = async () => {
  await ensureColumns();
  const [d, r] = await Promise.all([
    pool.query(`SELECT id, name FROM departments ORDER BY id`),
    pool.query(`SELECT department_id, trigger_key, enabled, value FROM recycle_rules`),
  ]);
  return { departments: d.rows, rules: r.rows, triggers: TRIGGERS, defaults: getDefaults() };
};

const saveRule = async (departmentId, key, enabled, value, userId) => {
  if (!TRIGGERS.some((t) => t.key === key)) return null;
  const r = await pool.query(
    `INSERT INTO recycle_rules (department_id, trigger_key, enabled, value, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT ((COALESCE(department_id, 0)), trigger_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, value = EXCLUDED.value,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING department_id, trigger_key, enabled, value`,
    [departmentId || null, key, !!enabled, Math.max(0, Math.min(3650, Number(value) || 0)), userId || null]
  );
  return r.rows[0];
};

const resetRule = async (departmentId, key) => {
  await ensureColumns();
  const r = await pool.query(
    `DELETE FROM recycle_rules WHERE COALESCE(department_id, 0) = COALESCE($1, 0) AND trigger_key = $2 RETURNING id`,
    [departmentId || null, key]
  );
  return r.rowCount;
};

// ── Lead rows ──
const SELECT_SQL = `
  SELECT l.id, l.lead_name, l.contact_number, l.status, l.assigned_to,
         l.department_id, l.service_type, l.dead_reason, l.dead_outcome, l.dead_notes,
         l.duplicate_of, dup.lead_name AS duplicate_of_name,
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
         (SELECT COUNT(*) FROM lead_notes n WHERE n.lead_id = l.id)::int AS contact_attempts,
         (SELECT COUNT(DISTINCT n.created_at::date) FROM lead_notes n WHERE n.lead_id = l.id)::int AS attempt_days,
         (SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id) AS last_attempt_at,
         (SELECT COUNT(*) FROM recycle_reminders rr
            WHERE rr.lead_id = l.id AND rr.cycle_no = COALESCE(l.cycle_no, 1))::int AS reminders_sent
  FROM leads l
  LEFT JOIN users u ON u.id = l.assigned_to
  LEFT JOIN leads dup ON dup.id = l.duplicate_of
  LEFT JOIN LATERAL (
    -- "meaningful activity" = a note/follow-up, an assignment or a recycle. Status edits do NOT count.
    SELECT GREATEST(
      COALESCE((SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id), l.created_at),
      COALESCE(l.assigned_at, l.created_at),
      COALESCE(l.recycled_at, l.created_at)
    ) AS last_activity
  ) la ON true`;

const resolveDepartments = async (rows) => {
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

// ── Reminder (Warm / Cold "no meaningful activity") ──
const reminderDue = (row, ctx) => {
  if (row.suppress_reason || !['Warm', 'Cold'].includes(row.status)) return null;
  const key = row.status === 'Warm' ? 'warm_reminder' : 'cold_reminder';
  const t = ruleFor(ctx.rules, row.resolved_department_id, key);
  if (!t.enabled) return null;
  return (Number(row.idle_days) || 0) >= t.value ? key : null;
};

// ── RULES ENGINE ──
// states: eligible / hold / cooling / exception / reminder / not_due / suppressed / not_candidate
const classify = (row, ctx) => {
  const { cfg } = ctx;
  const R = (k) => ruleFor(ctx.rules, row.resolved_department_id, k);
  if (row.suppress_reason) return { state: 'suppressed', reason: SUPPRESS_REASONS[row.suppress_reason] || row.suppress_reason };
  if (!['Warm', 'Cold', 'Dead'].includes(row.status)) return { state: 'not_candidate', reason: `status ${row.status} is never recycled` };

  const idle = Number(row.idle_days) || 0;
  const inStatus = Number(row.days_in_status) || 0;
  const now = new Date();
  const holdActive = row.hold_until && new Date(row.hold_until) > now;
  let due = false;
  let reason = '';

  if (row.status === 'Dead') {
    const dr = row.dead_reason;
    const label = DEAD_REASONS[dr] || dr;
    if (!dr) return { state: 'exception', reason: 'Dead reason not set (choose a reason in Dead reason ▾)' };
    // Wrong number / Duplicate / Do-not-contact are suppressed when recorded. If suppression was released, never auto-recycle.
    if (AUTO_SUPPRESS[dr]) return { state: 'exception', reason: `${label}: contact not permitted - set a new reason or suppress again` };
    if (dr === 'not_interested') return { state: 'exception', reason: 'Not Interested: customer refused - manager review / suppression, never auto-recycled' };
    if (dr === 'not_eligible') return { state: 'exception', reason: 'Not Eligible / Service Not Offered: disqualify or manager decision, no blind recycle' };
    if (dr === 'not_reachable' || dr === 'no_response') {
      const t = R('dead_not_reachable');
      const m = R('dead_min_attempts');
      if (!t.enabled) return { state: 'not_due', reason: 'trigger disabled' };
      if (dr === 'no_response' && (holdActive || row.has_future_followup)) {
        return { state: 'hold', reason: `${label}: client requested a date - waiting until it passes` };
      }
      if (m.enabled && Number(row.attempt_days) < m.value) {
        return { state: 'hold', reason: `${label}: needs ${m.value} attempts on distinct days (have ${row.attempt_days})` };
      }
      due = inStatus >= t.value;
      reason = `${label}: in Dead ${inStatus.toFixed(1)}d ${due ? '>=' : '<'} ${t.value}d`;
    } else {
      const t = R('dead_budget_timing');
      if (!t.enabled) return { state: 'not_due', reason: 'trigger disabled' };
      if (holdActive) return { state: 'hold', reason: `${label}: waiting for customer date` };
      if (row.has_future_followup) return { state: 'hold', reason: 'future follow-up scheduled' };
      if (!row.hold_until) return { state: 'exception', reason: `${label}: customer follow-up date needed` };
      due = true;
      reason = `${label}: customer date reached`;
    }
  } else {
    const t = R(row.status === 'Warm' ? 'warm_recycle' : 'cold_recycle');
    if (!t.enabled) {
      due = false;
      reason = 'trigger disabled';
    } else {
      due = idle >= t.value && inStatus >= cfg.minStatusDays;
      reason = `no activity ${idle.toFixed(1)}d ${idle >= t.value ? '>=' : '<'} ${t.value}d`;
    }
  }

  if (!due) {
    const rk = reminderDue(row, ctx);
    if (rk) return { state: 'reminder', reason: `no activity ${idle.toFixed(1)}d — reminder / follow-up warning` };
    return { state: 'not_due', reason };
  }
  if (row.cooling_until && new Date(row.cooling_until) > now) {
    return { state: 'cooling', reason: `cooling period until ${new Date(row.cooling_until).toLocaleDateString('en-GB')}` };
  }
  if (holdActive) return { state: 'hold', reason: 'approved hold active' };
  if (row.has_future_followup) return { state: 'hold', reason: 'future follow-up scheduled' };
  if (Number(row.cycle_no) >= cfg.maxCycles) return { state: 'exception', reason: `max cycles (${cfg.maxCycles}) reached` };
  if (!row.resolved_department_id) return { state: 'exception', reason: 'no department linked (set department / service type)' };
  return { state: 'eligible', reason };
};

const ownershipState = (row, c) => {
  if (row.suppress_reason || row.status === 'Closed') return 'Closed';
  if (c.state === 'cooling') return 'Cooling Period';
  if (c.state === 'eligible') return 'Auto-Recycle Pending';
  if (c.state === 'exception') return 'Manual Exception Review';
  if (Number(row.cycle_no) > 1) return 'Recycled/Reassigned';
  return 'Assigned';
};

const lifecycleStatus = (row) => {
  if (row.suppress_reason) return SUPPRESS_REASONS[row.suppress_reason] || row.suppress_reason;
  if (row.status === 'New' && Number(row.contact_attempts) > 0) return 'Attempting Contact';
  return row.status;
};

const decorate = (row, ctx) => {
  const c = classify(row, ctx);
  const d = (v) => Math.floor(Number(v) || 0);
  return {
    ...row,
    ...c,
    ownership_state: ownershipState(row, c),
    lifecycle_status: lifecycleStatus(row),
    dead_reason_label: row.dead_reason ? DEAD_REASONS[row.dead_reason] || row.dead_reason : null,
    total_age_days: d(row.total_age_days),
    idle_days: d(row.idle_days),
    days_in_status: d(row.days_in_status),
    days_since_assignment: d(row.days_since_assignment),
  };
};

// ── Writes ──
const markRecycled = async (leadId, cfg) => {
  const r = await pool.query(
    `UPDATE leads
        SET cycle_no = COALESCE(cycle_no, 1) + 1,
            recycled_at = NOW(),
            cooling_until = NOW() + ($3::int * INTERVAL '1 day'),
            hold_until = NULL,
            dead_reason = NULL,
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

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// hold for N days, or "until end of <date>" (study intakes, visa windows, customer dates)
const setHold = async (leadId, { days = 0, until = null }) => {
  await ensureColumns();
  const untilDate = isDate(until) ? until : null;
  const r = await pool.query(
    `UPDATE leads
        SET hold_until = CASE
              WHEN $2::text IS NOT NULL THEN (($2::text)::date + 1)::timestamp
              WHEN $3::int > 0 THEN NOW() + ($3::int * INTERVAL '1 day')
              ELSE NULL END
      WHERE id = $1 AND status IN ('Warm','Cold','Dead')
      RETURNING id, hold_until`,
    [leadId, untilDate, Math.max(0, Math.min(365, Number(days) || 0))]
  );
  return r.rows[0] || null;
};

// Dead submission: reason + outcome + notes (+ next contact date where relevant). Reasons Wrong Number / Duplicate /
// Do-Not-Contact are suppressed in the same statement. Returns { error } when validation fails.
const setDeadReason = async (leadId, { reason, outcome, notes, date, duplicateOf, actorId }) => {
  await ensureColumns();
  if (!DEAD_REASONS[reason]) return { error: 'Invalid reason' };
  let dupId = null;
  if (reason === 'duplicate') {
    dupId = Number(duplicateOf);
    if (!Number.isSafeInteger(dupId) || dupId <= 0 || dupId === Number(leadId)) return { error: 'Enter the canonical (original) lead ID — it must be a different lead' };
    const ex = await pool.query(`SELECT id FROM leads WHERE id = $1`, [dupId]);
    if (!ex.rows[0]) return { error: `Canonical lead #${dupId} not found` };
  }
  const needsDate = reason === 'budget' || reason === 'timing';
  const dateOk = (reason === 'no_response' || needsDate) && isDate(date);
  if (needsDate && !dateOk) return { error: 'Customer-confirmed follow-up date is required (YYYY-MM-DD)' };
  const auto = AUTO_SUPPRESS[reason] || null;
  const noteText = (reason === 'wrong_number' ? 'Data correction needed: ' : '') + String(notes || '');
  const r = await pool.query(
    `UPDATE leads
        SET dead_reason = $2::text, dead_outcome = $3, dead_notes = $4,
            hold_until = CASE WHEN $5::text IS NOT NULL THEN (($5::text)::date + 1)::timestamp ELSE hold_until END,
            duplicate_of = CASE WHEN $2::text = 'duplicate' THEN $6::int ELSE duplicate_of END,
            suppress_reason = COALESCE($7::text, suppress_reason),
            suppress_note = CASE WHEN $7::text IS NOT NULL THEN left($8::text, 255) ELSE suppress_note END,
            suppressed_at = CASE WHEN $7::text IS NOT NULL THEN NOW() ELSE suppressed_at END,
            suppressed_by = CASE WHEN $7::text IS NOT NULL THEN $9::int ELSE suppressed_by END
      WHERE id = $1 AND status = 'Dead'
      RETURNING id, dead_reason, hold_until, suppress_reason`,
    [leadId, reason, String(outcome || '').slice(0, 120), String(notes || '').slice(0, 255),
     dateOk ? date : null, dupId, auto, noteText, actorId || null]
  );
  return r.rows[0] ? { row: r.rows[0] } : { error: 'Lead not found or not Dead' };
};

// Resolve "no department" exception. Only fills an EMPTY department_id; never overwrites one.
const setDepartment = async (leadId, departmentId) => {
  await ensureColumns();
  const r = await pool.query(
    `UPDATE leads SET department_id = $2
      WHERE id = $1 AND department_id IS NULL
        AND EXISTS (SELECT 1 FROM departments d WHERE d.id = $2)
      RETURNING id, department_id`,
    [leadId, departmentId]
  );
  return r.rows[0] || null;
};

const suppressLead = async (leadId, reason, note, userId, duplicateOf) => {
  await ensureColumns();
  if (!SUPPRESS_REASONS[reason]) return { error: 'Invalid reason' };
  let dupId = null;
  if (reason === 'duplicate') {
    dupId = Number(duplicateOf);
    if (!Number.isSafeInteger(dupId) || dupId <= 0 || dupId === Number(leadId)) return { error: 'Enter the canonical (original) lead ID — it must be a different lead' };
    const ex = await pool.query(`SELECT id FROM leads WHERE id = $1`, [dupId]);
    if (!ex.rows[0]) return { error: `Canonical lead #${dupId} not found` };
  }
  const r = await pool.query(
    `UPDATE leads
        SET suppress_reason = $2::text, suppress_note = $3, suppressed_at = NOW(), suppressed_by = $4,
            duplicate_of = CASE WHEN $2::text = 'duplicate' THEN $5::int ELSE duplicate_of END
      WHERE id = $1
      RETURNING id, suppress_reason`,
    [leadId, reason, (note || '').slice(0, 255) || null, userId || null, dupId]
  );
  return r.rows[0] ? { row: r.rows[0] } : { error: 'Lead not found' };
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

// Logged actor + mandatory reason for every admin override (Section 04)
const audit = async (leadId, action, actor, reason, details) => {
  await pool.query(
    `INSERT INTO recycle_audit (lead_id, action, actor_id, actor_role, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [leadId, action, actor?.id || null, actor?.role || null, String(reason || ''), details ? JSON.stringify(details) : null]
  );
};

const recordReminder = async (leadId, cycleNo, kind, userId, channel) => {
  const r = await pool.query(
    `INSERT INTO recycle_reminders (lead_id, cycle_no, kind, user_id, channel)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lead_id, cycle_no, kind) DO NOTHING
     RETURNING id`,
    [leadId, cycleNo, kind, userId || null, channel || null]
  );
  return r.rows[0] || null;
};

module.exports = {
  SUPPRESS_REASONS, DEAD_REASONS, TRIGGERS, getConfig, getDefaults, ensureColumns, getContext,
  getRulesPayload, saveRule, resetRule, getCandidates, getSuppressed, getLeadLifecycleRow,
  reminderDue, classify, ownershipState, lifecycleStatus, decorate,
  markRecycled, setHold, setDeadReason, setDepartment, suppressLead, releaseSuppression, recordReminder, audit,
};