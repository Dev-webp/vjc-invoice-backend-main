const pool = require('../config/db');

const generateQuoteId = async () => {
  const result = await pool.query(
    'SELECT quote_id FROM quotes ORDER BY id DESC LIMIT 1'
  );

  if (result.rows.length === 0) return 'QT-000001';

  const last = result.rows[0].quote_id;
  const num = parseInt(last.replace('QT-', ''), 10) + 1;

  return 'QT-' + String(num).padStart(6, '0');
};

module.exports = { generateQuoteId };