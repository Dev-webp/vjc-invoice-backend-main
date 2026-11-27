// NEW FILE (v5) — Lifecycle + Recycling rules engine + trigger matrix + attempt log + queue + transactional round-robin.
// Touches NO existing file. Reads existing tables; only ADDS new columns / tables / triggers (all removable).
const pool = require('../config/db');
const departmentModel = require('./department.model');

const getConfig = () => ({
  maxCycles: Number(process.env.RECYCLE_MAX_CYCLES) || 2,          // default only; per-service value lives in Rules
  coolingDays: Number(process.env.RECYCLE_COOLING_DAYS) || 3,
  minStatusDays: Number(process.env.RECYCLE_MIN_STATUS_DAYS) || 1,
  batch: Number(process.env.RECYCLE_BATCH) || 50,
  flagPostponeCount: Number(process.env.RECYCLE_FLAG_POSTPONES) || 3,     // reschedules on one lead => "repeated"
  flagPostponeLeads: Number(process.env.RECYCLE_FLAG_POSTPONE_LEADS) || 3, // leads with repeated postponing => flag
  flagEarlyDeadDays: Number(process.env.RECYCLE_FLAG_EARLY_DEAD_DAYS) || 2,
  flagEarlyDeadMin: Number(process.env.RECYCLE_FLAG_EARLY_DEAD_MIN) || 3,
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
const AUTO_SUPPRESS = { wrong_number: 'invalid_contact', duplicate: 'duplicate', do_not_contact: 'do_not_contact' };

// Contact attempt log (Section 05)
const CHANNELS = { call: 'Call', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', visit: 'Visit', other: 'Other' };
const OUTCOMES = { connected: 'Connected', no_answer: 'No answer', busy: 'Busy', wrong_number: 'Wrong number', callback: 'Callback requested' };

// ── Trigger matrix + routing policy (Director/Admin can override globally or per department) ──
const TRIGGERS = [
  { key: 'warm_reminder', label: 'Warm: no meaningful activity → reminder', unit: 'calendar days' },
  { key: 'warm_recycle', label: 'Warm: still no progress → auto-recycle', unit: 'calendar days' },
  { key: 'cold_reminder', label: 'Cold: no meaningful activity → reminder', unit: 'calendar days' },
  { key: 'cold_recycle', label: 'Cold: still no progress → auto-recycle', unit: 'calendar days' },
  { key: 'dead_not_reachable', label: 'Dead (Not Reachable / No Response): cooldown, then queue & reassign', unit: 'calendar days in Dead' },
  { key: 'dead_min_attempts', label: 'Dead (Not Reachable / No Response): minimum attempts on distinct days', unit: 'distinct days' },
  { key: 'dead_budget_timing', label: 'Dead (Budget / Not Now / Timing): recycle after customer date', unit: 'on / off', noValue: true },
  { key: 'max_cycles', label: 'Maximum recycle cycles (exceeding → Manual Exception Review)', unit: 'cycles', alwaysOn: true },
  { key: 'consultant_capacity', label: 'Routing: max active leads per consultant (capacity check)', unit: 'active leads' },
  { key: 'notify_admin_no_consultant', label: 'Routing: notify Admin (in-system) when no other eligible consultant exists', unit: 'on / off', noValue: true, globalOnly: true },
  { key: 'notes_count_as_activity', label: 'Transition: also count existing notes / follow-ups as activity (turn OFF once consultants log attempts)', unit: 'on / off', noValue: true, globalOnly: true },
];
const getDefaults = () => ({
  warm_reminder: { enabled: false, value: 3 },
  warm_recycle: { enabled: true, value: Number(process.env.RECYCLE_WARM_DAYS) || 7 },
  cold_reminder: { enabled: false, value: 7 },
  cold_recycle: { enabled: true, value: Number(process.env.RECYCLE_COLD_DAYS) || 14 },
  dead_not_reachable: { enabled: true, value: Number(process.env.RECYCLE_DEAD_DAYS) || 3 },
  dead_min_attempts: { enabled: true, value: 3 },
  dead_budget_timing: { enabled: true, value: 0 },
  max_cycles: { enabled: true, value: Number(process.env.RECYCLE_MAX_CYCLES) || 2 },
  consultant_capacity: { enabled: false, value: 30 },
  notify_admin_no_consultant: { enabled: true, value: 0 },
  notes_count_as_activity: { enabled: true, value: 0 },
});

// Only ADDS columns / tables / triggers (IF NOT EXISTS). Existing columns and data are never changed.
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
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_rules (
        id SERIAL PRIMARY KEY, department_id INTEGER, trigger_key VARCHAR(40) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true, value INTEGER NOT NULL DEFAULT 0,
        updated_by INTEGER, updated_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS recycle_rules_uq
                        ON recycle_rules ((COALESCE(department_id, 0)), trigger_key)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_reminders (
        id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, cycle_no INTEGER NOT NULL DEFAULT 1,
        kind VARCHAR(30) NOT NULL, user_id INTEGER, channel VARCHAR(20), sent_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (lead_id, cycle_no, kind))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_audit (
        id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, action VARCHAR(30) NOT NULL, actor_id INTEGER,
        actor_role VARCHAR(30), reason TEXT NOT NULL, details JSONB, created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS recycle_audit_lead_idx ON recycle_audit (lead_id)`);
      // Section 05: genuine contact attempts (self-reported unless a telephony integration is added later)
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_attempts (
        id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, cycle_no INTEGER NOT NULL DEFAULT 1,
        channel VARCHAR(20) NOT NULL, outcome VARCHAR(20) NOT NULL,
        attempt_time TIMESTAMP NOT NULL DEFAULT NOW(), duration_seconds INTEGER, call_ref VARCHAR(60),
        source VARCHAR(20) NOT NULL DEFAULT 'self_reported', note VARCHAR(255),
        next_followup_date DATE, customer_confirmed BOOLEAN NOT NULL DEFAULT false, reschedule_reason VARCHAR(255),
        actor_id INTEGER, actor_role VARCHAR(30), created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS recycle_attempts_lead_idx ON recycle_attempts (lead_id, id)`);
      // Section 05: every follow-up date ever set / rescheduled (original date + all changes, reason, actor, time)
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_followup_history (
        id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, note_id INTEGER, old_date DATE, new_date DATE,
        reason VARCHAR(255), actor_id INTEGER, source VARCHAR(20) NOT NULL, changed_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS recycle_followup_history_lead_idx ON recycle_followup_history (lead_id)`);
      // Section 06: persistent queue (unique per lead/cycle), per-department cursor, assignment events
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_queue (
        id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, cycle_no INTEGER NOT NULL, department_id INTEGER,
        state VARCHAR(20) NOT NULL, reason TEXT, blocked_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(), evaluated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (lead_id, cycle_no))`);
      // In-system notifications (no WhatsApp): reminders, recycled-to-you, admin alerts
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_notifications (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, lead_id INTEGER, kind VARCHAR(30) NOT NULL,
        message TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW(), read_at TIMESTAMP)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS recycle_notifications_user_idx ON recycle_notifications (user_id, read_at)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_cursor (
        department_id INTEGER PRIMARY KEY, last_user_id INTEGER, updated_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS recycle_events (
        id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, cycle_no INTEGER NOT NULL,
        old_owner INTEGER, new_owner INTEGER, department_id INTEGER, routing_reason VARCHAR(60),
        actor_id INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
      // "Time in current status": fills ONLY the new column status_changed_at. Non-fatal if it fails.
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
      // Follow-up history for the EXISTING follow-up notes: AFTER trigger that only copies the date change into
      // recycle_followup_history. Errors inside are swallowed, so it can never break a note insert/update. Non-fatal.
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION lead_notes_track_followup() RETURNS trigger AS $fn$
          BEGIN
            BEGIN
              IF TG_OP = 'INSERT' THEN
                IF NEW.add_to_reminder = true AND NEW.reminder_date IS NOT NULL THEN
                  INSERT INTO recycle_followup_history (lead_id, note_id, old_date, new_date, actor_id, source)
                  VALUES (NEW.lead_id, NEW.id, NULL, NEW.reminder_date, NEW.commented_by, 'note');
                END IF;
              ELSIF NEW.reminder_date IS NOT NULL AND NEW.reminder_date IS DISTINCT FROM OLD.reminder_date THEN
                INSERT INTO recycle_followup_history (lead_id, note_id, old_date, new_date, actor_id, source)
                VALUES (NEW.lead_id, NEW.id, OLD.reminder_date, NEW.reminder_date, NEW.commented_by, 'note');
              END IF;
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
            RETURN NEW;
          END;
          $fn$ LANGUAGE plpgsql`);
        await pool.query(`DROP TRIGGER IF EXISTS trg_lead_notes_followup ON lead_notes`);
        await pool.query(`CREATE TRIGGER trg_lead_notes_followup
                          AFTER INSERT OR UPDATE OF reminder_date ON lead_notes
                          FOR EACH ROW EXECUTE FUNCTION lead_notes_track_followup()`);
      } catch (e) {
        console.warn('[RECYCLE] follow-up history trigger not installed:', e.message);
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
const notesFlag = (rules) => !!ruleFor(rules, null, 'notes_count_as_activity').enabled;

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
  const t = TRIGGERS.find((x) => x.key === key);
  if (!t) return null;
  const dep = t.globalOnly ? null : departmentId || null;
  const r = await pool.query(
    `INSERT INTO recycle_rules (department_id, trigger_key, enabled, value, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT ((COALESCE(department_id, 0)), trigger_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, value = EXCLUDED.value,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING department_id, trigger_key, enabled, value`,
    [dep, key, t.alwaysOn ? true : !!enabled, Math.max(0, Math.min(3650, Number(value) || 0)), userId || null]
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

// ── Lead rows ($1 = "existing notes count as activity" transition flag) ──
const SELECT_SQL = `
  WITH norm AS (
    SELECT id, right(regexp_replace(COALESCE(contact_number, ''), '\\D', '', 'g'), 10) AS n
    FROM leads WHERE suppress_reason IS DISTINCT FROM 'duplicate'
  ),
  dups AS (
    SELECT n, COUNT(*) AS c, array_agg(id ORDER BY id) AS ids FROM norm WHERE length(n) >= 7 GROUP BY n
  )
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
         (
           ($1::boolean AND EXISTS (SELECT 1 FROM lead_notes n
                 WHERE n.lead_id = l.id AND n.add_to_reminder = true
                   AND COALESCE(n.dismissed, false) = false
                   AND n.reminder_date >= CURRENT_DATE))
           OR EXISTS (SELECT 1 FROM (SELECT next_followup_date, customer_confirmed FROM recycle_attempts a
                        WHERE a.lead_id = l.id AND a.cycle_no = COALESCE(l.cycle_no, 1)
                        ORDER BY a.id DESC LIMIT 1) z
                      WHERE z.customer_confirmed = true AND z.next_followup_date >= CURRENT_DATE)
         ) AS has_future_followup,
         ((SELECT COUNT(*) FROM recycle_attempts a WHERE a.lead_id = l.id)
          + (CASE WHEN $1::boolean THEN (SELECT COUNT(*) FROM lead_notes n WHERE n.lead_id = l.id) ELSE 0 END))::int AS contact_attempts,
         (SELECT COUNT(DISTINCT x.d) FROM (
             SELECT a.attempt_time::date AS d FROM recycle_attempts a WHERE a.lead_id = l.id
             UNION
             SELECT n.created_at::date FROM lead_notes n WHERE n.lead_id = l.id AND $1::boolean
          ) x)::int AS attempt_days,
         (SELECT MAX(t) FROM (
             SELECT MAX(a.attempt_time) AS t FROM recycle_attempts a WHERE a.lead_id = l.id
             UNION ALL
             SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id AND $1::boolean
          ) y) AS last_attempt_at,
         (SELECT COUNT(*) FROM recycle_reminders rr
            WHERE rr.lead_id = l.id AND rr.cycle_no = COALESCE(l.cycle_no, 1) AND rr.kind IN ('warm_reminder','cold_reminder'))::int AS reminders_sent,
         length(regexp_replace(COALESCE(l.contact_number, ''), '\\D', '', 'g')) AS contact_digits,
         GREATEST(COALESCE(dp.c, 0) - 1, 0)::int AS dup_contact_count,
         (SELECT x FROM unnest(COALESCE(dp.ids, ARRAY[]::int[])) x WHERE x <> l.id LIMIT 1) AS dup_contact_lead_id,
         q.created_at AS queued_at, q.blocked_reason
  FROM leads l
  LEFT JOIN users u ON u.id = l.assigned_to
  LEFT JOIN leads dup ON dup.id = l.duplicate_of
  LEFT JOIN dups dp ON dp.n = right(regexp_replace(COALESCE(l.contact_number, ''), '\\D', '', 'g'), 10)
  LEFT JOIN recycle_queue q ON q.lead_id = l.id AND q.cycle_no = COALESCE(l.cycle_no, 1)
  LEFT JOIN LATERAL (
    -- "meaningful activity" = a logged contact attempt, an assignment or a recycle (+ notes only while the transition flag is ON).
    -- Status edits, note edits and follow-up date edits are NOT meaningful activity.
    SELECT GREATEST(
      COALESCE((SELECT MAX(a.attempt_time) FROM recycle_attempts a WHERE a.lead_id = l.id), l.created_at),
      CASE WHEN $1::boolean THEN COALESCE((SELECT MAX(n.created_at) FROM lead_notes n WHERE n.lead_id = l.id), l.created_at)
           ELSE l.created_at END,
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
const getCandidates = async (onlyId = null, rules = null) => {
  const flag = notesFlag(rules || (await loadRules()));
  const params = [flag];
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
  const flag = notesFlag(await loadRules());
  const r = await pool.query(`${SELECT_SQL} WHERE l.suppress_reason IS NOT NULL ORDER BY l.suppressed_at DESC NULLS LAST`, [flag]);
  return r.rows;
};

const getLeadLifecycleRow = async (id) => {
  const flag = notesFlag(await loadRules());
  const r = await pool.query(`${SELECT_SQL} WHERE l.id = $2`, [flag, id]);
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
// Eligibility order (Section 06): not Converted/Closed/DNC -> valid unique contact -> correct team/service ->
// sufficient attempts/aging -> no protected follow-up/hold -> cooldown elapsed -> cycle limit.
// (Leads that are simply not aged yet stay hidden as "not_due" so the queue is not flooded.)
const classify = (row, ctx) => {
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
    if (!dr) return { state: 'exception', reason: 'Dead reason not set (choose a reason in Dead reason)' };
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
      if (row.has_future_followup) return { state: 'hold', reason: 'documented customer follow-up pending' };
      if (!row.hold_until) return { state: 'exception', reason: `${label}: customer follow-up date needed` };
      due = true;
      reason = `${label}: customer date reached`;
    }
  } else {
    const t = R(row.status === 'Warm' ? 'warm_recycle' : 'cold_recycle');
    if (!t.enabled) {
      reason = 'trigger disabled';
    } else {
      due = idle >= t.value && inStatus >= ctx.cfg.minStatusDays;
      reason = `no meaningful activity ${idle.toFixed(1)}d ${idle >= t.value ? '>=' : '<'} ${t.value}d`;
    }
  }

  if (!due) {
    if (reminderDue(row, ctx)) return { state: 'reminder', reason: `no meaningful activity ${idle.toFixed(1)}d — reminder / follow-up warning` };
    return { state: 'not_due', reason };
  }
  // 2. valid unique contact
  const digits = Number(row.contact_digits) || 0;
  if (digits < 7 || digits > 15) return { state: 'exception', reason: 'invalid contact number - needs data correction' };
  if (Number(row.dup_contact_count) > 0) {
    return { state: 'exception', reason: `same number also on lead #${row.dup_contact_lead_id} - link canonical lead / suppress duplicate` };
  }
  // 3. correct team / service
  if (!row.resolved_department_id) return { state: 'exception', reason: 'no department linked (set department / service type)' };
  // 5. protected follow-up / manager-approved hold (expired holds resume normal evaluation)
  if (holdActive) return { state: 'hold', reason: 'manager-approved hold active' };
  if (row.has_future_followup) return { state: 'hold', reason: 'documented customer follow-up pending' };
  // 6. cooldown elapsed
  if (row.cooling_until && new Date(row.cooling_until) > now) {
    return { state: 'cooling', reason: `cooling period until ${new Date(row.cooling_until).toLocaleDateString('en-GB')}` };
  }
  // 7. cycle limit (per service)
  const maxC = R('max_cycles').value;
  if (Number(row.cycle_no) >= maxC) return { state: 'exception', reason: `max cycles (${maxC}) reached` };
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

// ── Section 06: ONE idempotent evaluation path (scheduled job + on Dead submission); queue unique per lead/cycle ──
const persistQueue = async (rows, ctx) => {
  if (!rows.length) return 0;
  const ids = []; const cycles = []; const states = []; const reasons = []; const depts = [];
  rows.forEach((r) => {
    const c = classify(r, ctx);
    ids.push(r.id); cycles.push(Number(r.cycle_no)); states.push(c.state); reasons.push(c.reason); depts.push(r.resolved_department_id || null);
  });
  await pool.query(
    `INSERT INTO recycle_queue (lead_id, cycle_no, state, reason, department_id, evaluated_at)
     SELECT t.lead_id, t.cycle_no, t.state, t.reason, t.department_id, NOW()
       FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::int[]) AS t(lead_id, cycle_no, state, reason, department_id)
     ON CONFLICT (lead_id, cycle_no) DO UPDATE
       SET state = CASE WHEN recycle_queue.state = 'assigned' THEN recycle_queue.state ELSE EXCLUDED.state END,
           reason = CASE WHEN recycle_queue.state = 'assigned' THEN recycle_queue.reason ELSE EXCLUDED.reason END,
           department_id = EXCLUDED.department_id, evaluated_at = NOW()`,
    [ids, cycles, states, reasons, depts]
  );
  await pool.query(
    `UPDATE recycle_queue q SET state = 'suppressed', evaluated_at = NOW()
      WHERE q.state NOT IN ('assigned', 'suppressed')
        AND EXISTS (SELECT 1 FROM leads l WHERE l.id = q.lead_id AND l.suppress_reason IS NOT NULL)`
  );
  return rows.length;
};
const evaluateAll = async (ctx) => persistQueue(await getCandidates(null, ctx.rules), ctx);
const evaluateOne = async (leadId) => {
  const ctx = await getContext();
  return persistQueue(await getCandidates(leadId, ctx.rules), ctx);
};
const markBlocked = async (leadId, cycleNo, text) => {
  await pool.query(`UPDATE recycle_queue SET blocked_reason = $3 WHERE lead_id = $1 AND cycle_no = $2`, [leadId, cycleNo, text]);
};

// ── Section 06: transactional assignment with row-level lock + separate round-robin cursor per team/service ──
let optTables = null;
const optionalTables = async () => {
  if (!optTables) {
    const r = await pool.query(`SELECT to_regclass('staff_meeting_mode') IS NOT NULL AS meeting, to_regclass('agent_red_flags') IS NOT NULL AS flags`);
    optTables = r.rows[0];
  }
  return optTables;
};

// Pool = same live-availability filters the existing assignment uses (online, not in meeting, < 3 red flags today)
// + optional capacity. Never hard-codes a person.
const poolSql = (o, cap) => `
  SELECT ds.staff_id FROM department_staff ds
   WHERE ds.department_id = $1
     AND ds.is_online = true
     AND ds.staff_id <> $2
     ${o.meeting ? `AND ds.staff_id NOT IN (SELECT staff_id FROM staff_meeting_mode WHERE in_meeting = true AND updated_at >= CURRENT_DATE)` : ''}
     ${o.flags ? `AND ds.staff_id NOT IN (SELECT staff_id FROM agent_red_flags WHERE flag_date = CURRENT_DATE GROUP BY staff_id HAVING COUNT(*) >= 3)` : ''}
     ${cap ? `AND (SELECT COUNT(*) FROM leads x WHERE x.assigned_to = ds.staff_id AND x.status NOT IN ('Closed','Dead')) < $3` : ''}
   ORDER BY ds.staff_id`;

// opts: { deptId, maxCycles, coolingDays, capacity (number|null), routing, actorId }
const recycleLeadTx = async (leadId, opts) => {
  await ensureColumns();
  const o = await optionalTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lr = await client.query(
      `SELECT id, status, assigned_to, COALESCE(cycle_no, 1) AS cycle_no, suppress_reason
         FROM leads WHERE id = $1 FOR UPDATE`, [leadId]);
    const lead = lr.rows[0];
    if (!lead || !['Warm', 'Cold', 'Dead'].includes(lead.status) || lead.suppress_reason || !lead.assigned_to
        || Number(lead.cycle_no) >= opts.maxCycles) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'lead changed meanwhile (skipped)' };
    }
    // lock the cursor row of this team/service
    await client.query(`INSERT INTO recycle_cursor (department_id) VALUES ($1) ON CONFLICT (department_id) DO NOTHING`, [opts.deptId]);
    const cur = await client.query(`SELECT last_user_id FROM recycle_cursor WHERE department_id = $1 FOR UPDATE`, [opts.deptId]);
    const last = cur.rows[0]?.last_user_id || 0;

    const params = [opts.deptId, lead.assigned_to];
    if (opts.capacity) params.push(opts.capacity);
    const pool2 = await client.query(poolSql(o, !!opts.capacity), params);
    const ids = pool2.rows.map((r) => Number(r.staff_id));
    if (!ids.length) {
      await client.query('ROLLBACK');
      return { ok: false, noConsultant: true, cycleNo: Number(lead.cycle_no), reason: 'no other eligible consultant available (stays in queue)' };
    }
    const staffId = ids.find((x) => x > last) ?? ids[0];       // next after cursor, wrap around
    const newCycle = Number(lead.cycle_no) + 1;

    await client.query(
      `UPDATE leads
          SET cycle_no = $2, recycled_at = NOW(),
              cooling_until = NOW() + ($3::int * INTERVAL '1 day'),
              hold_until = NULL, dead_reason = NULL,
              status = 'New', status_changed_at = NOW(),
              assigned_to = $4, department_id = $5, assigned_at = NOW(),
              sla_deadline = NOW() + INTERVAL '30 minutes', red_flag_triggered = false,
              updated_at = NOW()
        WHERE id = $1`,
      [leadId, newCycle, opts.coolingDays, staffId, opts.deptId]
    );
    await client.query(
      `INSERT INTO lead_assignment_history (lead_id, assigned_to, assigned_by, reason) VALUES ($1, $2, NULL, $3)`,
      [leadId, staffId, `recycled_cycle_${newCycle}`]
    );
    await client.query(
      `INSERT INTO recycle_events (lead_id, cycle_no, old_owner, new_owner, department_id, routing_reason, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [leadId, newCycle, lead.assigned_to, staffId, opts.deptId, `${opts.routing || 'auto'}:round_robin_cursor`, opts.actorId || null]
    );
    await client.query(`UPDATE recycle_cursor SET last_user_id = $2, updated_at = NOW() WHERE department_id = $1`, [opts.deptId, staffId]);
    await client.query(
      `UPDATE recycle_queue SET state = 'assigned', blocked_reason = NULL, evaluated_at = NOW() WHERE lead_id = $1 AND cycle_no = $2`,
      [leadId, Number(lead.cycle_no)]
    );
    await client.query('COMMIT');
    return { ok: true, cycle_no: newCycle, staffId, oldOwner: lead.assigned_to };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
};

const getAdminIds = async () => {
  const r = await pool.query(`SELECT id FROM users WHERE role = 'chairman'`);
  return r.rows.map((x) => x.id);
};

// ── Writes (admin actions; each is audited by the controller) ──
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

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

// ── In-system notifications ──
const notify = async (userId, leadId, kind, message) => {
  if (!userId) return null;
  await ensureColumns();
  const r = await pool.query(
    `INSERT INTO recycle_notifications (user_id, lead_id, kind, message) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, leadId || null, kind, String(message).slice(0, 500)]
  );
  return r.rows[0];
};
const listNotifications = async (userId) => {
  await ensureColumns();
  const [items, unread] = await Promise.all([
    pool.query(
      `SELECT n.id, n.lead_id, n.kind, n.message, n.created_at, n.read_at, l.lead_name
         FROM recycle_notifications n LEFT JOIN leads l ON l.id = n.lead_id
        WHERE n.user_id = $1
        ORDER BY (n.read_at IS NULL) DESC, n.id DESC LIMIT 50`, [userId]),
    pool.query(`SELECT COUNT(*)::int AS c FROM recycle_notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]),
  ]);
  return { items: items.rows, unread: unread.rows[0].c };
};
const markNotificationsRead = async (userId, ids) => {
  await ensureColumns();
  if (Array.isArray(ids) && ids.length) {
    await pool.query(`UPDATE recycle_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::int[])`, [userId, ids.map(Number).filter(Number.isSafeInteger)]);
  } else {
    await pool.query(`UPDATE recycle_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  }
};

// ── Section 05: contact attempt log ──
// Self-reported by the consultant (no telephony integration exists). Also saves a plain note so the EXISTING
// 30-minute SLA check (which looks for a note by the assigned consultant) is satisfied.
const createAttempt = async (leadId, actor, b) => {
  await ensureColumns();
  if (!CHANNELS[b.channel]) return { error: 'Select a valid channel' };
  if (!OUTCOMES[b.outcome]) return { error: 'Select a valid outcome' };
  const when = b.attempt_time ? new Date(b.attempt_time) : new Date();
  if (Number.isNaN(when.getTime())) return { error: 'Invalid attempt time' };
  if (when.getTime() > Date.now() + 5 * 60 * 1000) return { error: 'Attempt time cannot be in the future' };
  const dur = b.duration_seconds === '' || b.duration_seconds == null ? null : Number(b.duration_seconds);
  if (dur !== null && (!Number.isFinite(dur) || dur < 0 || dur > 86400)) return { error: 'Duration must be between 0 and 86400 seconds' };
  const nextDate = b.next_followup_date || null;
  if (nextDate && !isDate(nextDate)) return { error: 'Follow-up date must be YYYY-MM-DD' };
  if (nextDate && nextDate < new Date().toISOString().slice(0, 10)) return { error: 'Follow-up date cannot be in the past' };
  if (b.outcome === 'callback' && !nextDate) return { error: 'Callback requested: enter the next follow-up date' };
  const confirmed = !!b.customer_confirmed && !!nextDate;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lr = await client.query(`SELECT id, lead_name, assigned_to, COALESCE(cycle_no, 1) AS cycle_no FROM leads WHERE id = $1`, [leadId]);
    const lead = lr.rows[0];
    if (!lead) { await client.query('ROLLBACK'); return { error: 'Lead not found' }; }
    if (actor.role !== 'chairman' && Number(lead.assigned_to) !== Number(actor.id)) {
      await client.query('ROLLBACK');
      return { error: 'You can log attempts only on leads assigned to you' };
    }
    // reschedule rule: keep the original date and every change; a changed date needs a reason
    const prev = await client.query(
      `SELECT next_followup_date FROM recycle_attempts WHERE lead_id = $1 AND cycle_no = $2 ORDER BY id DESC LIMIT 1`,
      [leadId, lead.cycle_no]
    );
    const prevDate = prev.rows[0]?.next_followup_date ? new Date(prev.rows[0].next_followup_date).toISOString().slice(0, 10) : null;
    const reason = String(b.reschedule_reason || '').trim();
    const isReschedule = !!(prevDate && nextDate && prevDate !== nextDate);
    if (isReschedule && reason.length < 3) {
      await client.query('ROLLBACK');
      return { error: `Follow-up was ${prevDate}. A reason is mandatory to change it` };
    }
    const ins = await client.query(
      `INSERT INTO recycle_attempts
         (lead_id, cycle_no, channel, outcome, attempt_time, duration_seconds, call_ref, source, note,
          next_followup_date, customer_confirmed, reschedule_reason, actor_id, actor_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'self_reported',$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [leadId, lead.cycle_no, b.channel, b.outcome, when, dur, String(b.call_ref || '').slice(0, 60) || null,
       String(b.note || '').slice(0, 255) || null, nextDate, confirmed, isReschedule ? reason.slice(0, 255) : null,
       actor.id, actor.role || null]
    );
    if (nextDate && (isReschedule || !prevDate)) {
      await client.query(
        `INSERT INTO recycle_followup_history (lead_id, old_date, new_date, reason, actor_id, source)
         VALUES ($1, $2, $3, $4, $5, 'attempt_log')`,
        [leadId, isReschedule ? prevDate : null, nextDate, isReschedule ? reason.slice(0, 255) : null, actor.id]
      );
    }
    const remark = `[Attempt - self-reported] ${CHANNELS[b.channel]}: ${OUTCOMES[b.outcome]}${b.note ? ` - ${String(b.note).slice(0, 200)}` : ''}`;
    await client.query(
      `INSERT INTO lead_notes (lead_id, remark, add_to_reminder, reminder_date, reminder_time, commented_by)
       VALUES ($1, $2, false, NULL, NULL, $3)`,
      [leadId, remark, actor.id]
    );
    await client.query('COMMIT');
    return { row: ins.rows[0] };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
};

const getLeadOwner = async (leadId) => {
  const r = await pool.query(`SELECT id, lead_name, assigned_to FROM leads WHERE id = $1`, [leadId]);
  return r.rows[0] || null;
};

const listAttempts = async (leadId) => {
  await ensureColumns();
  const [a, h] = await Promise.all([
    pool.query(
      `SELECT a.*, u.name AS actor_name FROM recycle_attempts a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.lead_id = $1 ORDER BY a.id DESC`, [leadId]),
    pool.query(
      `SELECT h.*, u.name AS actor_name FROM recycle_followup_history h LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.lead_id = $1 ORDER BY h.id ASC`, [leadId]),
  ]);
  return { attempts: a.rows, followup_history: h.rows };
};

const myLeads = async (userId) => {
  await ensureColumns();
  const r = await pool.query(
    `SELECT l.id, l.lead_name, l.contact_number, l.status, COALESCE(l.cycle_no, 1) AS cycle_no,
            (SELECT COUNT(*) FROM recycle_attempts a WHERE a.lead_id = l.id)::int AS attempts,
            (SELECT MAX(a.attempt_time) FROM recycle_attempts a WHERE a.lead_id = l.id) AS last_attempt_at,
            pf.next_followup_date, pf.customer_confirmed
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT next_followup_date, customer_confirmed FROM recycle_attempts
          WHERE lead_id = l.id AND cycle_no = COALESCE(l.cycle_no, 1) ORDER BY id DESC LIMIT 1) pf ON true
      WHERE l.assigned_to = $1 AND l.suppress_reason IS NULL AND l.status <> 'Closed'
      ORDER BY l.updated_at DESC
      LIMIT 500`,
    [userId]
  );
  return r.rows;
};

// ── Section 05: manager analytics flags (patterns only — never an accusation) ──
const getAnalytics = async () => {
  await ensureColumns();
  const cfg = getConfig();
  const r = await pool.query(
    `WITH rs AS (
       SELECT lead_id, COUNT(*) FILTER (WHERE old_date IS NOT NULL AND new_date > old_date)::int AS reschedules
         FROM recycle_followup_history GROUP BY lead_id
     )
     SELECT u.id, u.name,
            COUNT(l.id)::int AS assigned_total,
            COUNT(*) FILTER (WHERE l.status = 'Dead')::int AS dead_total,
            COUNT(*) FILTER (WHERE l.status = 'Dead' AND l.status_changed_at IS NOT NULL AND l.assigned_at IS NOT NULL
                               AND l.status_changed_at - l.assigned_at < ($1::int * INTERVAL '1 day'))::int AS early_dead,
            COUNT(*) FILTER (WHERE COALESCE(rs.reschedules, 0) >= $2::int)::int AS repeat_postponed_leads,
            COALESCE(SUM(rs.reschedules), 0)::int AS reschedules_total
       FROM users u
       JOIN leads l ON l.assigned_to = u.id
       LEFT JOIN rs ON rs.lead_id = l.id
      GROUP BY u.id, u.name
      ORDER BY u.name`,
    [cfg.flagEarlyDeadDays, cfg.flagPostponeCount]
  );
  const rows = r.rows.map((x) => {
    const flags = [];
    if (x.repeat_postponed_leads >= cfg.flagPostponeLeads) {
      flags.push(`Follow-ups postponed ${cfg.flagPostponeCount}+ times on ${x.repeat_postponed_leads} leads`);
    }
    if (x.early_dead >= cfg.flagEarlyDeadMin) {
      flags.push(`${x.early_dead} leads marked Dead within ${cfg.flagEarlyDeadDays} day(s) of assignment`);
    }
    return { ...x, flags };
  });
  return { thresholds: cfg, consultants: rows };
};

module.exports = {
  SUPPRESS_REASONS, DEAD_REASONS, CHANNELS, OUTCOMES, TRIGGERS,
  getConfig, getDefaults, ensureColumns, getContext, ruleFor,
  getRulesPayload, saveRule, resetRule,
  getCandidates, getSuppressed, getLeadLifecycleRow,
  reminderDue, classify, ownershipState, lifecycleStatus, decorate,
  evaluateAll, evaluateOne, markBlocked, recycleLeadTx, getAdminIds,
  setHold, setDeadReason, setDepartment, suppressLead, releaseSuppression, recordReminder, audit,
  createAttempt, getLeadOwner, listAttempts, myLeads, getAnalytics,
  notify, listNotifications, markNotificationsRead,
};