const pool = require('../config/db');

const createExpenseTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id          SERIAL PRIMARY KEY,
      expense_no  VARCHAR(20) UNIQUE NOT NULL,
      date        DATE NOT NULL,
      category    VARCHAR(100) NOT NULL,
      customer    VARCHAR(255) DEFAULT '-',
      amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
      billable    BOOLEAN DEFAULT true,
      status      VARCHAR(50) NOT NULL DEFAULT 'Billable',
      notes       TEXT DEFAULT '',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✅ expenses table ready");
};

module.exports = { createExpenseTable };