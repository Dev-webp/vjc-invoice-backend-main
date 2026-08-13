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
const pickNextStaffForDepartment = async (departmentId) => {
  const result = await pool.query(
    `SELECT staff_id FROM department_staff
     WHERE department_id = $1
     ORDER BY last_assigned_at ASC NULLS FIRST
     LIMIT 1`,
    [departmentId]
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

module.exports = {
  ensureTables,
  getAllDepartments,
  addStaffToDepartment,
  removeStaffFromDepartment,
  pickNextStaffForDepartment,
  getDepartmentIdByServiceType,
};