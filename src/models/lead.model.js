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
  const result = await pool.query(
    `UPDATE leads
     SET branch = $1, assigned_to = $2, assigned_by = $3, updated_at = NOW()
     WHERE id = ANY($4::int[])
     RETURNING *`,
    [branch, staffId, assignedBy, ids]
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
const createLeadFromWebhook = async ({ lead_name, contact_number, email, source }) => {
  const result = await pool.query(
    `INSERT INTO leads
      (lead_name, contact_number, email, source, created_by, status)
     VALUES ($1,$2,$3,$4,$5,'New')
     RETURNING *`,
    [lead_name, contact_number, email || null, source, null]
  );
  return result.rows[0];
};

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
};