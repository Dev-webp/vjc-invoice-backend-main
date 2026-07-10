const pool = require('../config/db');

const getAllQuotes = async ({ role, userId, page = 1, limit = 25 } = {}) => {
  let baseQuery = ' FROM quotes';
  const vals = [];

if (role !== 'chairman' && role !== 'mis-executive' && userId) {
  baseQuery += ' WHERE created_by = $1';
  vals.push(userId);
}

const countResult = await pool.query(`SELECT COUNT(*)${baseQuery}`, vals);
const total = parseInt(countResult.rows[0].count, 10);

const offset = (page - 1) * limit;
const paramIndex = vals.length + 1;
const dataQuery = `SELECT *${baseQuery} ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

console.log("ROLE:", role);
console.log("USER ID:", userId);
console.log("QUERY:", dataQuery);

const result = await pool.query(dataQuery, [...vals, limit, offset]);

console.log("QUOTE RESULT:", result.rows);

return { rows: result.rows, total };
};
const getQuoteById = async (id) => {
  const result = await pool.query(
    'SELECT * FROM quotes WHERE id = $1',
    [id]
  );
  return result.rows[0];
};

const createQuote = async (data) => {
  const {
    quote_id,
    customer_id,
    customer_name,
    customer_email,
    salesperson,
    quote_date,
    expiry_date,
    subtotal,
    gst,
    total_amount,
    notes,
    status
  } = data;

  const result = await pool.query(
`INSERT INTO quotes
(quote_id, customer_id, customer_name, salesperson,
 quote_date, expiry_date, total_amount, status, notes, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING *`,
[
  quote_id,
  customer_id,
  customer_name,
  salesperson || null,
  quote_date,
  expiry_date,
  total_amount || 0,
  status || 'Draft',
  notes || null,
  data.created_by || null
]
  );

  return result.rows[0];
};

const updateQuote = async (id, data) => {
  const {
    customer_id,
    customer_name,
    customer_email,
    salesperson,
    quote_date,
    expiry_date,
    subtotal,
    gst,
    total_amount,
    notes,
    status
  } = data;

  const result = await pool.query(
    `UPDATE quotes SET
      customer_id=$1,
      customer_name=$2,
      customer_email=$3,
      salesperson=$4,
      quote_date=$5,
      expiry_date=$6,
      subtotal=$7,
      gst=$8,
      total_amount=$9,
      notes=$10,
      status=$11
    WHERE id=$12
    RETURNING *`,
    [
      customer_id,
      customer_name,
      customer_email,
      salesperson,
      quote_date,
      expiry_date,
      subtotal,
      gst,
      total_amount,
      notes,
      status,
      id
    ]
  );

  return result.rows[0];
};

const updateQuoteStatus = async (id, status) => {
  const result = await pool.query(
    'UPDATE quotes SET status=$1 WHERE id=$2 RETURNING *',
    [status, id]
  );

  return result.rows[0];
};

const deleteQuote = async (id) => {
  await pool.query(
    'DELETE FROM quotes WHERE id=$1',
    [id]
  );
};

module.exports = {
  getAllQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
};