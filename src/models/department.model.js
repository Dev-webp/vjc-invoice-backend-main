const pool = require('../config/db');

// One-time setup: creates the 2 new tables + adds department_id to leads.
// Safe to run multiple times — uses IF NOT EXISTS everywhere.
const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS department_staff (
      id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
      staff_id INTEGER NOT NULL,
      last_assigned_at TIMESTAMP DEFAULT NULL,
      UNIQUE(department_id, staff_id)
    )
  `);

  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id)
  `);

  // ▼▼▼ NEW — paste this block right here ▼▼▼
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT NULL
  `);
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMP DEFAULT NULL
  `);
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS red_flag_triggered BOOLEAN DEFAULT false
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_red_flags (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL,
      lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
      flag_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
await pool.query(`
    ALTER TABLE lead_assignment_history ADD COLUMN IF NOT EXISTS reason VARCHAR(50) DEFAULT 'manual'
  `);

  await pool.query(`
    ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false
  `);
  // ▲▲▲ NEW block ends here ▲▲▲

  // Seed the 5 BRD departments if they don't exist yet.
  const names = [
    'Study Visas',
    'Immigration / PR',
    'Visitor Visas / Tourism Packages',
    'Air Tickets Enquiries',
    'Forex Enquiries',
  ];
  for (const name of names) {
    await pool.query(
      `INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }
};

const getAllDepartments = async () => {
  const result = await pool.query(`
    SELECT d.*,
           COALESCE(
             json_agg(
               json_build_object('staff_id', ds.staff_id, 'name', u.name)
             ) FILTER (WHERE ds.staff_id IS NOT NULL),
             '[]'
           ) AS staff
    FROM departments d
    LEFT JOIN department_staff ds ON ds.department_id = d.id
    LEFT JOIN users u ON u.id = ds.staff_id
    GROUP BY d.id
    ORDER BY d.id
  `);
  return result.rows;
};

const addStaffToDepartment = async (departmentId, staffId) => {
  await pool.query(
    `INSERT INTO department_staff (department_id, staff_id) VALUES ($1, $2)
     ON CONFLICT (department_id, staff_id) DO NOTHING`,
    [departmentId, staffId]
  );
};

const removeStaffFromDepartment = async (departmentId, staffId) => {
  await pool.query(
    `DELETE FROM department_staff WHERE department_id = $1 AND staff_id = $2`,
    [departmentId, staffId]
  );
};

// Round-robin: picks the staff member in this department who was
// assigned longest ago (or never), then stamps their last_assigned_at.
const pickNextStaffForDepartment = async (departmentId, excludeStaffId = null) => {
  const params = [departmentId];
  let excludeClause = '';
  if (excludeStaffId) {
    params.push(excludeStaffId);
    excludeClause = `AND ds.staff_id != $${params.length}`;
  }

  const result = await pool.query(
    `SELECT ds.staff_id FROM department_staff ds
     WHERE ds.department_id = $1
       ${excludeClause}
       AND ds.staff_id NOT IN (
         SELECT staff_id FROM agent_red_flags
         WHERE flag_date = CURRENT_DATE
         GROUP BY staff_id
         HAVING COUNT(*) >= 3
       )
     ORDER BY ds.last_assigned_at ASC NULLS FIRST
     LIMIT 1`,
    params
  );
  if (!result.rows[0]) return null;

  const staffId = result.rows[0].staff_id;
  await pool.query(
    `UPDATE department_staff SET last_assigned_at = NOW()
     WHERE department_id = $1 AND staff_id = $2`,
    [departmentId, staffId]
  );
  return staffId;
};

const getDepartmentIdByServiceType = async (serviceType) => {
  const result = await pool.query(
    `SELECT id FROM departments WHERE name = $1`,
    [serviceType]
  );
  return result.rows[0]?.id || null;
};

// ▼▼▼ NEW — paste this block right here ▼▼▼
const addRedFlag = async (staffId, leadId) => {
  await pool.query(
    `INSERT INTO agent_red_flags (staff_id, lead_id) VALUES ($1, $2)`,
    [staffId, leadId]
  );
};

const getRedFlagCountToday = async (staffId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM agent_red_flags
     WHERE staff_id = $1 AND flag_date = CURRENT_DATE`,
    [staffId]
  );
  return result.rows[0].count;
};
// ▲▲▲ NEW block ends here ▲▲▲

module.exports = {
  ensureTables,
  getAllDepartments,
  addStaffToDepartment,
  removeStaffFromDepartment,
  pickNextStaffForDepartment,
  getDepartmentIdByServiceType,
  addRedFlag,
  getRedFlagCountToday,
};