const pool = require('../config/db');

// NEW FILE — one-time setup for the Agreement e-signature feature.
// Adds 4 new columns to the EXISTING `customers` table only.
// Uses "ADD COLUMN IF NOT EXISTS" everywhere — safe to run on every
// server start, never touches/alters any existing column or table,
// never drops or renames anything.
const ensureAgreementSignColumns = async () => {
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS agreement_signed BOOLEAN DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS agreement_signature TEXT
  `);
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS agreement_signed_name VARCHAR(255)
  `);
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMP DEFAULT NULL
  `);
};

module.exports = { ensureAgreementSignColumns };