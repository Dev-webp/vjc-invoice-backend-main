const pool = require('../config/db');

// ── Create a new lead / enquiry ─────────────────────────────────────────────
const createLead = async (data, createdBy) => {
  const {
    lead_name,
    contact_number,
    alternate_contact_number,
    email,
    gender,
    source,
    education_qualification,
    work_experience,
    work_description,
    interested_countries, // array e.g. ["Germany", "Canada"]
    service_type,
    branch,
  } = data;

  const result = await pool.query(
    `INSERT INTO leads
      (lead_name, contact_number, alternate_contact_number, email, gender,
       source, education_qualification, work_experience, work_description,
       interested_countries, service_type, branch, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'New')
     RETURNING *`,
    [
      lead_name,
      contact_number,
      alternate_contact_number || null,
      email || null,
      gender || null,
      source,
      education_qualification || null,
      work_experience || null,
      work_description || null,
      JSON.stringify(interested_countries || []),
      service_type || null,
      branch || null,
      createdBy,
    ]
  );
  return result.rows[0];
};

// ── Get all leads — role aware ──────────────────────────────────────────────
// Chairman / Admin -> sees everything
// Employee         -> sees only leads created by them OR assigned to them
const getAllLeads = async ({ role, userId, filters = {} }) => {
  const values = [];
  const conditions = [];

if (role !== 'chairman' && role !== 'mis-executive') {
    values.push(userId, userId);
    conditions.push(`(l.created_by = $${values.length - 1} OR l.assigned_to = $${values.length})`);
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`l.status = $${values.length}`);
  }
  if (filters.source) {
    values.push(filters.source);
    conditions.push(`l.source = $${values.length}`);
  }
  if (filters.branch) {
    values.push(filters.branch);
    conditions.push(`l.branch = $${values.length}`);
  }
  if (filters.keyword) {
    values.push(`%${filters.keyword}%`);
    conditions.push(
      `(l.lead_name ILIKE $${values.length} OR l.email ILIKE $${values.length} OR l.contact_number ILIKE $${values.length})`
    );
  }
  if (filters.dateFrom && filters.dateTo) {
    values.push(filters.dateFrom, filters.dateTo);
    conditions.push(`l.created_at::date BETWEEN $${values.length - 1} AND $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT l.*,
            (SELECT COUNT(*) FROM lead_notes n WHERE n.lead_id = l.id) AS notes_count,
            cb.name AS created_by_name,
            ab.name AS assigned_by_name,
            at.name AS assigned_to_name
     FROM leads l
     LEFT JOIN users cb ON cb.id = l.created_by
     LEFT JOIN users ab ON ab.id = l.assigned_by
     LEFT JOIN users at ON at.id = l.assigned_to
     ${whereClause}
     ORDER BY l.created_at DESC`,
    values
  );
  return result.rows;
};

const getLeadById = async (id) => {
  const result = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
  return result.rows[0];
};

// ── Assign a lead to a branch + staff member ────────────────────────────────
const assignLead = async (id, branch, staffId, assignedBy) => {
  const result = await pool.query(
    `UPDATE leads
     SET branch = $1, assigned_to = $2, assigned_by = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [branch, staffId, assignedBy, id]
  );
  return result.rows[0];
};

// ── Bulk assign (checkbox multi-select like screenshot 5/6) ─────────────────
const assignLeadsBulk = async (ids, branch, staffId, assignedBy) => {
  const deptResult = await pool.query(
    `SELECT department_id FROM department_staff WHERE staff_id = $1 LIMIT 1`,
    [staffId]
  );
  const departmentId = deptResult.rows[0]?.department_id || null;

  const result = await pool.query(
    `UPDATE leads
     SET branch = $1, assigned_to = $2, assigned_by = $3, updated_at = NOW(),
         assigned_at = NOW(),
         sla_deadline = NOW() + INTERVAL '30 minutes',
         red_flag_triggered = false,
         department_id = $5
     WHERE id = ANY($4::int[])
     RETURNING *`,
    [branch, staffId, assignedBy, ids, departmentId]
  );

  // Logs this assignment so screenshot 4's "ASSIGNED HISTORY" table has data.
  await pool.query(
    `INSERT INTO lead_assignment_history (lead_id, branch, assigned_to, assigned_by)
     SELECT unnest($1::int[]), $2, $3, $4`,
    [ids, branch, staffId, assignedBy]
  );

  return result.rows;
};

// ── Update enquiry status (Warm/Cold/Prospect/HOLD/Pending Agreement/Dead) ──
const updateLeadStatus = async (id, status) => {
  const result = await pool.query(
    `UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return result.rows[0];
};

// ── Notes (Add Notes dialog — screenshot 3) ─────────────────────────────────
const getNotesByLeadId = async (leadId) => {
  const result = await pool.query(
    `SELECT n.*, u.name AS commented_by_name
     FROM lead_notes n
     LEFT JOIN users u ON u.id = n.commented_by
     WHERE n.lead_id = $1
     ORDER BY n.created_at DESC`,
    [leadId]
  );
  return result.rows;
};

const addNoteToLead = async (leadId, data, commentedBy) => {
  const { remark, add_to_reminder, reminder_date, reminder_time } = data;
  const result = await pool.query(
    `INSERT INTO lead_notes
      (lead_id, remark, add_to_reminder, reminder_date, reminder_time, commented_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [leadId, remark, !!add_to_reminder, reminder_date || null, reminder_time || null, commentedBy]
  );
  return result.rows[0];
};

// ── Full profile-history page (screenshot 4) ────────────────────────────────
const getLeadProfileHistory = async (leadId) => {
  const leadResult = await pool.query(
    `SELECT l.*,
            cb.name AS created_by_name,
            ab.name AS assigned_by_name,
            at.name AS assigned_to_name
     FROM leads l
     LEFT JOIN users cb ON cb.id = l.created_by
     LEFT JOIN users ab ON ab.id = l.assigned_by
     LEFT JOIN users at ON at.id = l.assigned_to
     WHERE l.id = $1`,
    [leadId]
  );

  const historyResult = await pool.query(
    `SELECT h.*, ab.name AS assigned_by_name, at.name AS user_name
     FROM lead_assignment_history h
     LEFT JOIN users ab ON ab.id = h.assigned_by
     LEFT JOIN users at ON at.id = h.assigned_to
     WHERE h.lead_id = $1
     ORDER BY h.assigned_date DESC`,
    [leadId]
  );

  const notesResult = await pool.query(
    `SELECT n.*, u.name AS commented_by
     FROM lead_notes n
     LEFT JOIN users u ON u.id = n.commented_by
     WHERE n.lead_id = $1
     ORDER BY n.created_at DESC`,
    [leadId]
  );

  return {
    lead: leadResult.rows[0],
    assigned_history: historyResult.rows,
    notes: notesResult.rows,
  };
};

// ── Create a lead coming from Facebook/Instagram webhook ────────────────────
const createLeadFromWebhook = async ({ lead_name, contact_number, email, source, last_remark }) => {
  const result = await pool.query(
    `INSERT INTO leads
      (lead_name, contact_number, email, source, last_remark, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,'New')
     RETURNING *`,
    [lead_name, contact_number, email || null, source, last_remark || null, null]
  );
  return result.rows[0];
};
// ▼▼▼ NEW — paste this block right here ▼▼▼
const autoAssignLead = async (leadId, staffId, departmentId) => {
  const result = await pool.query(
    `UPDATE leads
     SET assigned_to = $1,
         department_id = $2,
         assigned_at = NOW(),
         sla_deadline = NOW() + INTERVAL '30 minutes',
         red_flag_triggered = false,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [staffId, departmentId, leadId]
  );
  return result.rows[0];
};
const logAssignmentHistory = async (leadId, staffId, reason) => {
  await pool.query(
    `INSERT INTO lead_assignment_history (lead_id, assigned_to, assigned_by, reason)
     VALUES ($1, $2, NULL, $3)`,
    [leadId, staffId, reason]
  );
};

// ▼▼▼ NEW — paste this block right here ▼▼▼
const getDueReminders = async (staffId) => {
  const result = await pool.query(
    `SELECT n.id AS note_id, n.remark, n.reminder_date, n.reminder_time,
            l.id AS lead_id, l.lead_name
     FROM lead_notes n
     JOIN leads l ON l.id = n.lead_id
     WHERE n.commented_by = $1
       AND n.add_to_reminder = true
       AND n.dismissed = false
       AND n.reminder_date IS NOT NULL
       AND (n.reminder_date + COALESCE(n.reminder_time, '00:00'::time)) <= NOW()
     ORDER BY n.reminder_date, n.reminder_time`,
    [staffId]
  );
  return result.rows;
};

const dismissReminder = async (noteId, staffId) => {
  const result = await pool.query(
    `UPDATE lead_notes SET dismissed = true
     WHERE id = $1 AND commented_by = $2
     RETURNING *`,
    [noteId, staffId]
  );
  return result.rows[0];
};

const getNewAssignments = async (staffId) => {
  const result = await pool.query(
    `SELECT h.id AS history_id, h.lead_id, h.reason, h.assigned_date,
            l.lead_name
     FROM lead_assignment_history h
     JOIN leads l ON l.id = h.lead_id
     WHERE h.assigned_to = $1
       AND h.notified = false
     ORDER BY h.assigned_date ASC`,
    [staffId]
  );
  return result.rows;
};

const markAssignmentNotified = async (historyId, staffId) => {
  const result = await pool.query(
    `UPDATE lead_assignment_history SET notified = true
     WHERE id = $1 AND assigned_to = $2
     RETURNING *`,
    [historyId, staffId]
  );
  return result.rows[0];
};

// ▼▼▼ NEW — paste this block right here ▼▼▼
// Chairman/mis-executive only — every assignment made today, across all agents
const getAllAssignmentsToday = async () => {
  const result = await pool.query(
    `SELECT h.id AS history_id, h.lead_id, h.reason, h.assigned_date,
            l.lead_name, u.name AS assigned_to_name
     FROM lead_assignment_history h
     JOIN leads l ON l.id = h.lead_id
     LEFT JOIN users u ON u.id = h.assigned_to
     WHERE h.assigned_date::date = CURRENT_DATE
     ORDER BY h.assigned_date DESC`
  );
  return result.rows;
};
// ▲▲▲ NEW block ends here ▲▲▲
// ▲▲▲ NEW block ends here ▲▲▲
const getExpiredSlaLeads = async () => {
  const result = await pool.query(
    `SELECT l.* FROM leads l
     WHERE l.sla_deadline IS NOT NULL
       AND l.sla_deadline < NOW()
       AND l.red_flag_triggered = false
       AND l.assigned_to IS NOT NULL
       AND l.status = 'New'
       AND NOT EXISTS (
         SELECT 1 FROM lead_notes n
         WHERE n.lead_id = l.id
           AND n.commented_by = l.assigned_to
           AND n.created_at > l.assigned_at
       )`
  );
  return result.rows;
};

const markRedFlagTriggered = async (leadId) => {
  await pool.query(`UPDATE leads SET red_flag_triggered = true WHERE id = $1`, [leadId]);
};
// ▲▲▲ NEW block ends here ▲▲▲

// ▼▼▼ NEW — Pending Assignment (chairman-only): leads nobody was online to receive ▼▼▼
const getPendingAssignmentLeads = async () => {
  const result = await pool.query(
    `SELECT l.*, d.name AS department_name
     FROM leads l
     LEFT JOIN departments d ON d.id = l.department_id
     WHERE l.assigned_to IS NULL
       AND l.source IN ('Facebook', 'Instagram')
     ORDER BY l.created_at DESC`
  );
  return result.rows;
};
// ▲▲▲ NEW block ends here ▲▲▲

module.exports = {
  createLead,
  getAllLeads,
  getLeadById,
  assignLead,
  assignLeadsBulk,
  updateLeadStatus,
  getNotesByLeadId,
  addNoteToLead,
  getLeadProfileHistory,
  createLeadFromWebhook,
  autoAssignLead,
  getExpiredSlaLeads,
  markRedFlagTriggered,
  logAssignmentHistory,
  getDueReminders,
  dismissReminder,
  getNewAssignments,
  markAssignmentNotified,
  getAllAssignmentsToday,
  getPendingAssignmentLeads,
};