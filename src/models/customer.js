const pool = require('../config/db');

// Auto-generate customer ID like CUS001, CUS002...
const generateCustomerId = async () => {
  const result = await pool.query(
    'SELECT customer_id FROM customers ORDER BY id DESC LIMIT 1'
  );
  if (result.rows.length === 0) return 'CUS001';
  const lastId = result.rows[0].customer_id;
  const num = parseInt(lastId.replace('CUS', '')) + 1;
  return 'CUS' + String(num).padStart(3, '0');
};

module.exports = { generateCustomerId };