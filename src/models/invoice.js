const pool = require('../config/db');
const crypto = require('crypto');

const generateInvoiceNumber = async (userId) => {
  const result = await pool.query(
    'SELECT invoice_number FROM invoices WHERE created_by = $1 ORDER BY id DESC LIMIT 1',
    [userId]
  );
  if (result.rows.length === 0) return 'INV001';
  const last = result.rows[0].invoice_number;
  const num = parseInt(last.replace('INV', '')) + 1;
  return 'INV' + String(num).padStart(3, '0');
};

const generateToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { generateInvoiceNumber, generateToken };