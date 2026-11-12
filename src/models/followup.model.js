const pool = require('../config/db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const getLead = async (leadId) => {
  const r = await pool.query(
    `SELECT id, lead_name, email, contact_number, interested_countries, status, assigned_to, created_by
     FROM leads WHERE id = $1`,
    [leadId]
  );
  return r.rows[0] || null;
};

const listFollowups = async (leadId) => {
  const r = await pool.query(
    `SELECT n.id, n.remark, n.created_at, n.commented_by,
            COALESCE(n.dismissed, false) AS done,
            to_char(n.reminder_date, 'YYYY-MM-DD') AS reminder_date,
            to_char(n.reminder_time, 'HH24:MI') AS reminder_time,
            u.name AS created_by_name,
            (SELECT d.name FROM department_staff ds
               JOIN departments d ON d.id = ds.department_id
              WHERE ds.staff_id = n.commented_by LIMIT 1) AS department
     FROM lead_notes n
     LEFT JOIN users u ON u.id = n.commented_by
     WHERE n.lead_id = $1 AND n.add_to_reminder = true
     ORDER BY n.created_at DESC`,
    [leadId]
  );
  return r.rows;
};

const addFollowup = async (leadId, { followup_date, followup_time, remarks }, userId) => {
  if (!DATE_RE.test(followup_date || '')) throw Object.assign(new Error('Next followup date is required'), { status: 400 });
  if (!TIME_RE.test(followup_time || '')) throw Object.assign(new Error('Next followup time is required'), { status: 400 });
  if (!remarks || !String(remarks).trim()) throw Object.assign(new Error('Remarks are required'), { status: 400 });
  const r = await pool.query(
    `INSERT INTO lead_notes (lead_id, remark, add_to_reminder, reminder_date, reminder_time, commented_by)
     VALUES ($1, $2, true, $3, $4, $5)
     RETURNING id`,
    [leadId, String(remarks).trim(), followup_date, followup_time, userId]
  );
  return r.rows[0];
};

// author or admin can mark a followup done
const markDone = async (noteId, userId, isAdmin) => {
  const r = await pool.query(
    `UPDATE lead_notes SET dismissed = true
     WHERE id = $1 AND add_to_reminder = true
       AND ($2::boolean OR commented_by::text = $3::text)
     RETURNING id`,
    [noteId, !!isAdmin, String(userId)]
  );
  return r.rows[0] || null;
};

const calendarEvents = async (from, to, userIdOrNull) => {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) throw Object.assign(new Error('from and to (YYYY-MM-DD) are required'), { status: 400 });
  const r = await pool.query(
    `SELECT n.id, n.lead_id, l.lead_name, n.remark,
            to_char(n.reminder_date, 'YYYY-MM-DD') AS date,
            to_char(n.reminder_time, 'HH24:MI') AS time,
            u.name AS agent_name
     FROM lead_notes n
     JOIN leads l ON l.id = n.lead_id
     LEFT JOIN users u ON u.id = n.commented_by
     WHERE n.add_to_reminder = true
       AND COALESCE(n.dismissed, false) = false
       AND n.reminder_date IS NOT NULL
       AND n.reminder_date BETWEEN $1::date AND $2::date
       AND ($3::text IS NULL OR n.commented_by::text = $3::text)
     ORDER BY n.reminder_date, n.reminder_time NULLS FIRST
     LIMIT 3000`,
    [from, to, userIdOrNull === null ? null : String(userIdOrNull)]
  );
  return r.rows;
};

module.exports = { getLead, listFollowups, addFollowup, markDone, calendarEvents };