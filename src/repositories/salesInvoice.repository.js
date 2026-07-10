const pool = require('../config/db');

const getAllSalesInvoices = async () => {
  const result = await pool.query('SELECT * FROM sales_invoices ORDER BY id DESC');
  return result.rows;
};

const getSalesInvoiceById = async (invoice_id) => {
  const result = await pool.query(
    'SELECT * FROM sales_invoices WHERE invoice_id = $1', [invoice_id]
  );
  return result.rows[0];
};

const createSalesInvoice = async (data) => {
  const {
    invoice_id, customer_id, customer_name, invoice_date,
    due_date, terms, line_items, notes, status, total_amount
  } = data;

  const result = await pool.query(
    `INSERT INTO sales_invoices
      (invoice_id, customer_id, customer_name, invoice_date,
       due_date, terms, line_items, notes, status, total_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      invoice_id, customer_id, customer_name, invoice_date,
      due_date || null, terms || 'Due on Receipt',
      JSON.stringify(line_items), notes || null,
      status || 'Draft', total_amount
    ]
  );
  return result.rows[0];
};

const updateSalesInvoice = async (invoice_id, data) => {
  const {
    customer_id, customer_name, invoice_date, due_date,
    terms, line_items, notes, status, total_amount
  } = data;

  const result = await pool.query(
    `UPDATE sales_invoices SET
      customer_id=$1, customer_name=$2, invoice_date=$3,
      due_date=$4, terms=$5, line_items=$6, notes=$7,
      status=$8, total_amount=$9
     WHERE invoice_id=$10
     RETURNING *`,
    [
      customer_id, customer_name, invoice_date,
      due_date || null, terms || 'Due on Receipt',
      JSON.stringify(line_items), notes || null,
      status, total_amount, invoice_id
    ]
  );
  return result.rows[0];
};

const updateSalesInvoiceStatus = async (invoice_id, status, paid_amount) => {
  if (paid_amount !== undefined && paid_amount !== null) {
    const result = await pool.query(
      `UPDATE sales_invoices SET
        status=$1,
        paid_amount=$2,
        balance_amount = total_amount - $2
       WHERE invoice_id=$3
       RETURNING *`,
      [status, paid_amount, invoice_id]
    );
    return result.rows[0];
  }
  const result = await pool.query(
    'UPDATE sales_invoices SET status=$1 WHERE invoice_id=$2 RETURNING *',
    [status, invoice_id]
  );
  return result.rows[0];
};

const deleteSalesInvoice = async (invoice_id) => {
  await pool.query('DELETE FROM sales_invoices WHERE invoice_id=$1', [invoice_id]);
};

module.exports = {
  getAllSalesInvoices,
  getSalesInvoiceById,
  createSalesInvoice,
  updateSalesInvoice,
  updateSalesInvoiceStatus,
  deleteSalesInvoice,
};