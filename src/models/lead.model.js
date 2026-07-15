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

  if (role !== 'chairman' && role !== 'admin') {
    values.push(userId, userId);
    conditions.push(`(created_by = $${values.length - 1} OR assigned_to = $${values.length})`);
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filters.source) {
    values.push(filters.source);
    conditions.push(`source = $${values.length}`);
  }
  if (filters.branch) {
    values.push(filters.branch);
    conditions.push(`branch = $${values.length}`);
  }
  if (filters.keyword) {
    values.push(`%${filters.keyword}%`);
    conditions.push(
      `(lead_name ILIKE $${values.length} OR email ILIKE $${values.length} OR contact_number ILIKE $${values.length})`
    );
  }
  if (filters.dateFrom && filters.dateTo) {
    values.push(filters.dateFrom, filters.dateTo);
    conditions.push(`created_at::date BETWEEN $${values.length - 1} AND $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT l.*,
            cb.name AS created_by_name,
            ab.name AS assigned_by_name,
            at.name AS assigned_to_name
     FROM leads l
     LEFT JOIN employees cb ON cb.id = l.created_by
     LEFT JOIN employees ab ON ab.id = l.assigned_by
     LEFT JOIN employees at ON at.id = l.assigned_to
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

module.exports = {
  createLead,
  getAllLeads,
  getLeadById,
  assignLead,
  assignLeadsBulk,
  updateLeadStatus,
};
