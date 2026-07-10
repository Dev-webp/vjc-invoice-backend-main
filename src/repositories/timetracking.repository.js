const pool = require('../config/db');

const timeTrackingRepository = {

  // ── PROJECTS ──
  getAllProjects: async () => {
    const result = await pool.query(`
      SELECT p.*, c.name as customer_name
      FROM projects p
      LEFT JOIN customers c ON p.customer_id = c.id
      ORDER BY p.created_at DESC
    `);
    return result.rows;
  },

  createProject: async (data) => {
    const { name, customer_id, status, budget } = data;
    const result = await pool.query(
      `INSERT INTO projects (name, customer_id, status, budget)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, customer_id, status || 'Active', budget || 0]
    );
    return result.rows[0];
  },

  // ── TIME LOGS ──
  getAllLogs: async () => {
    const result = await pool.query(`
      SELECT tl.*, p.name as project_name, c.name as customer_name
      FROM time_logs tl
      LEFT JOIN projects p ON tl.project_id = p.id
      LEFT JOIN customers c ON tl.customer_id = c.id
      ORDER BY tl.log_date DESC, tl.id DESC
    `);
    return result.rows;
  },

  getLogById: async (id) => {
    const result = await pool.query('SELECT * FROM time_logs WHERE id = $1', [id]);
    return result.rows[0];
  },

  createLog: async (data) => {
    const {
      log_no, project_id, customer_id, log_date,
      task, hours, billable, notes, hourly_rate
    } = data;

    const result = await pool.query(
      `INSERT INTO time_logs
        (log_no, project_id, customer_id, log_date, task, hours, billable, notes, hourly_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [log_no, project_id, customer_id, log_date, task, hours,
       billable !== false, notes || null, hourly_rate || 1500]
    );
    return result.rows[0];
  },

  updateLog: async (id, data) => {
    const { project_id, customer_id, log_date, task, hours, billable, notes } = data;
    const result = await pool.query(
      `UPDATE time_logs SET
        project_id=$1, customer_id=$2, log_date=$3, task=$4,
        hours=$5, billable=$6, notes=$7
       WHERE id=$8 RETURNING *`,
      [project_id, customer_id, log_date, task, hours, billable !== false, notes || null, id]
    );
    return result.rows[0];
  },

  deleteLog: async (id) => {
    const result = await pool.query('DELETE FROM time_logs WHERE id=$1 RETURNING *', [id]);
    return result.rows[0];
  },

  markInvoiced: async (id, invoice_id) => {
    const result = await pool.query(
      `UPDATE time_logs SET invoiced=true, invoice_id=$1 WHERE id=$2 RETURNING *`,
      [invoice_id, id]
    );
    return result.rows[0];
  },

  getStats: async () => {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(hours), 0) as total_hours,
        COALESCE(SUM(CASE WHEN billable THEN hours ELSE 0 END), 0) as billable_hours,
        COALESCE(SUM(CASE WHEN billable THEN hours * hourly_rate ELSE 0 END), 0) as billable_amount,
        COUNT(CASE WHEN invoiced THEN 1 END) as invoiced_count
      FROM time_logs
    `);
    const projStats = await pool.query(
      `SELECT COUNT(*) as active_projects FROM projects WHERE status='Active'`
    );
    return { ...result.rows[0], ...projStats.rows[0] };
  },
};

module.exports = timeTrackingRepository;