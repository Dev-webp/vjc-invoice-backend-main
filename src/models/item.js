const pool = require('../config/db');

const generateItemId = async () => {
  const result = await pool.query(
    'SELECT item_id FROM items ORDER BY id DESC LIMIT 1'
  );
  if (result.rows.length === 0) return 'ITM001';
  const last = result.rows[0].item_id;
  const num = parseInt(last.replace('ITM', '')) + 1;
  return 'ITM' + String(num).padStart(3, '0');
};

module.exports = { generateItemId };