// ============================================================
// FILE: VJC-Invoice-backend/src/models/payment.model.js
// ============================================================

const pool = require('../config/db');  // ← same as salesInvoice

const createPaymentTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS payments (
      id                SERIAL PRIMARY KEY,
      payment_no        VARCHAR(20) UNIQUE NOT NULL,
      invoice_id        VARCHAR(20),
      customer_id       VARCHAR(50) NOT NULL,
      customer_name     VARCHAR(255) NOT NULL,
      email             VARCHAR(255),
      request_date      DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date          DATE,
      amount_due        NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount_received   NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_method    VARCHAR(50) DEFAULT '',
      txn_ref           VARCHAR(100) DEFAULT '',
      paid_date         DATE,
      status            VARCHAR(50) NOT NULL DEFAULT 'Initial Request',
      notes             TEXT DEFAULT '',
      reminder_log      JSONB DEFAULT '[]',
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(query);
  console.log("payments table ready");
};

module.exports = { createPaymentTable };
