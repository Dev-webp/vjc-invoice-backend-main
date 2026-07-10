const pool = require('../config/db');

const createRecurringInvoiceTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_invoices (
      id                SERIAL PRIMARY KEY,
      profile_no        VARCHAR(20) UNIQUE NOT NULL,
      profile_name      VARCHAR(255) NOT NULL,
      customer_id       VARCHAR(50) NOT NULL,
      customer_name     VARCHAR(255) NOT NULL,
      frequency         VARCHAR(50) NOT NULL DEFAULT 'Monthly',
      payment_terms     VARCHAR(50) DEFAULT 'Net 30',
      start_date        DATE NOT NULL,
      end_date          DATE,
      no_end_date       BOOLEAN DEFAULT true,
      last_invoice_date DATE,
      next_invoice_date DATE,
      status            VARCHAR(20) NOT NULL DEFAULT 'Active',
      notes             TEXT DEFAULT '',
      line_items        JSONB DEFAULT '[]',
      generated_invoices JSONB DEFAULT '[]',
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✅ recurring_invoices table ready");
};

module.exports = { createRecurringInvoiceTable };