const pool = require('../config/db');

const generateSalesInvoiceId = async () => {
  const result = await pool.query(
    'SELECT invoice_id FROM sales_invoices ORDER BY id DESC LIMIT 1'
  );
  if (result.rows.length === 0) return 'INV-000001';
  const last = result.rows[0].invoice_id;
  const num  = parseInt(last.replace('INV-', ''), 10) + 1;
  return 'INV-' + String(num).padStart(6, '0');
};

module.exports = { generateSalesInvoiceId };