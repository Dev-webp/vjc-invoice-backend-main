const pool = require('../config/db');

const invoiceRepository = {

  getAll: async ({ role, userId } = {}) => {
  let query = `
    SELECT
      i.*,
      p.invoice_number AS original_invoice_number
    FROM invoices i
    LEFT JOIN invoices p
      ON i.original_invoice_id = p.id
  `;

  const vals = [];
  const conditions = [`i.status IN ('Approved', 'Paid')`];

  if (role !== 'chairman' && role !== 'mis-executive' && userId) {
    vals.push(userId);
    conditions.push(`i.created_by = $${vals.length}`);
  }

  query += ' WHERE ' + conditions.join(' AND ');

  query += ' ORDER BY i.created_at DESC';

  const result = await pool.query(query, vals);
  return result.rows;
},
  getByToken: async (token) => {
    const result = await pool.query(
      'SELECT * FROM invoices WHERE chairman_token = $1',
      [token]
    );
    return result.rows[0];
  },
getById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM invoices WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },
  create: async (data) => {
    const {
      invoice_number,
      customer_id,
      customer_name,
      customer_email,
      items,
      invoice_type,
      currency,
      invoice_date,
      payment_mode,
      reference_no,
      subtotal,
      tax_percent,
        tax_type,      
      tax_amount,
      total_amount,
      discount,
      grand_total,
      paid_amount,
      balance_amount,
      due_date,
      service_type,
      state_by,
      notes,
      chairman_token,
      screenshot_base64,
       original_invoice_id 
    } = data;
    console.log("INSERT DEBUG:", {
  invoice_number,
  customer_id,
  customer_name,
  created_by: data.created_by
});

    const result = await pool.query(
   `INSERT INTO invoices
  (invoice_number, customer_id, customer_name, customer_email,
   items, invoice_type, currency, invoice_date, payment_mode, reference_no,
subtotal, tax_percent, tax_type, tax_amount, total_amount, discount,
   grand_total, paid_amount, balance_amount,
   due_date, service_type, state_by, notes, chairman_token, status, created_by, screenshot_base64,  original_invoice_id)
      VALUES (
$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
$11,$12,$13,$14,$15,$16,$17,$18,
$19,$20,$21,$22,$23,$24,'Pending',$25,$26,$27
)
       RETURNING *`,
     [
  invoice_number, customer_id, customer_name, customer_email,
  JSON.stringify(items), invoice_type, currency, invoice_date, payment_mode, reference_no,
  subtotal, tax_percent,tax_type,   tax_amount, total_amount, discount,
  grand_total, paid_amount, balance_amount,
  due_date, service_type, state_by, notes, chairman_token,
  data.created_by || null,
  screenshot_base64 || null,
  original_invoice_id || null
]
    );

    return result.rows[0];
  },

  approve: async (token) => {
    const result = await pool.query(
      `UPDATE invoices
       SET status='Approved', approved_at=NOW()
       WHERE chairman_token=$1
       RETURNING *`,
      [token]
    );

    return result.rows[0];
  },

  reject: async (token) => {
    const result = await pool.query(
      `UPDATE invoices
       SET status='Rejected', rejected_at=NOW()
       WHERE chairman_token=$1
       RETURNING *`,
      [token]
    );

    return result.rows[0];
  },

  markPaidByInvoiceNumber: async (invoiceNumber) => {
    const result = await pool.query(
      `UPDATE invoices
       SET status='Paid', updated_at=NOW()
       WHERE invoice_number=$1
       RETURNING *`,
      [invoiceNumber]
    );
    return result.rows[0];
  },

  getStats: async () => {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_invoices,
        COUNT(CASE WHEN status='Pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status='Approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status='Rejected' THEN 1 END) as rejected,
        SUM(total_amount) as total_amount
      FROM invoices
    `);

    return result.rows[0];
  },
};

module.exports = invoiceRepository;
