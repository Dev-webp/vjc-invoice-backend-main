const pool = require('../config/db');

const generateLogNo = async () => {
  const result = await pool.query(
    'SELECT log_no FROM time_logs ORDER BY id DESC LIMIT 1'
  );
  if (result.rows.length === 0) return 'TL-001';
  const last = result.rows[0].log_no;
  const num = parseInt(last.replace('TL-', '')) + 1;
  return 'TL-' + String(num).padStart(3, '0');
};

module.exports = { generateLogNo };