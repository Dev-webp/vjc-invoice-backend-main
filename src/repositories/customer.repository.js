const pool = require('../config/db');

const customerRepository = {

  // Get all customers with filters
  getAll: async ({ search, status, type, userId, role, page = 1, limit = 25 }) => {
    let baseQuery = `
FROM customers c
LEFT JOIN (
  SELECT DISTINCT ON (customer_id)
    id,
    customer_id,
    status,
    balance_amount,
    paid_amount,
    created_at
  FROM invoices
  WHERE status = 'Approved'
  ORDER BY customer_id, id DESC
) i
ON c.id::text = i.customer_id
WHERE 1=1
`;
    const values = [];
    let i = 1;

    if (role !== 'chairman' && role !== 'mis-executive' && userId) {
      baseQuery += ` AND c.created_by = $${i}`;
      values.push(userId);
      i++;
    }
    if (search) {
      baseQuery += ` AND (name ILIKE $${i} OR email ILIKE $${i} OR company ILIKE $${i})`;
      values.push(`%${search}%`);
      i++;
    }
    if (status && status !== 'All') {
      baseQuery += ` AND c.status = $${i}`;
      values.push(status);
      i++;
    }
    if (type && type !== 'All') {
      baseQuery += ` AND c.type = $${i}`;
      values.push(type);
      i++;
    }

    // ── Count total (for pagination) ──
    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // ── Paginated data ──
    const dataQuery = `
SELECT
  c.*,
  COALESCE(i.status, 'Pending')   AS invoice_status,
  COALESCE(i.balance_amount, 0)   AS outstanding,
  COALESCE(i.paid_amount, 0)      AS total_payments,
  i.created_at                     AS last_transaction,
   i.id                            AS last_invoice_id
${baseQuery}
ORDER BY c.created_at DESC
LIMIT $${i} OFFSET $${i + 1}
`;
    const offset = (page - 1) * limit;
    const result = await pool.query(dataQuery, [...values, limit, offset]);

    return { rows: result.rows, total };
  },

  // Get single customer by ID
  getById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM customers WHERE id = $1', [id]
    );
    return result.rows[0];
  },

  // Get by customer_id like CUS001
  getByCustomerId: async (customer_id) => {
    const result = await pool.query(
      'SELECT * FROM customers WHERE customer_id = $1', [customer_id]
    );
    return result.rows[0];
  },

  // Create new customer
  create: async (data) => {
    const {
      customer_id, name, email, phone, company,
      service_type,
      type, status, address, city, state,
      pincode, gstin, notes, created_by
    } = data;

    const result = await pool.query(
      `INSERT INTO customers
(customer_id, name, email, phone, company, service_type, type, status,
 address, city, state, pincode, gstin, notes, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
RETURNING *`,
      [
        customer_id, name, email, phone, company,
        service_type,
        type, status,
        address, city, state, pincode, gstin, notes,
        created_by
      ]
    );
    return result.rows[0];
  },

  // Update customer
  update: async (id, data) => {
    const {
      name, email, phone, company, type, status,
      address, city, state, pincode, gstin, notes
    } = data;

    const result = await pool.query(
      `UPDATE customers SET
        name=$1, email=$2, phone=$3, company=$4, type=$5,
        status=$6, address=$7, city=$8, state=$9, pincode=$10,
        gstin=$11, notes=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [name, email, phone, company, type, status,
       address, city, state, pincode, gstin, notes, id]
    );
    return result.rows[0];
  },

  // Delete customer
  delete: async (id) => {
    const result = await pool.query(
      'DELETE FROM customers WHERE id = $1 RETURNING *', [id]
    );
    return result.rows[0];
  },

  // ✅ FIXED: Get stats from latest approved invoices (not customers table)
  getStats: async (role, userId) => {
    let query = `
     SELECT
  COUNT(DISTINCT c.id)                                      AS total_customers,
  COUNT(DISTINCT CASE WHEN c.status='Active' THEN c.id END) AS active_customers,

  COALESCE(SUM(latest.balance_amount), 0)                   AS total_outstanding,

  COALESCE(SUM(allinv.total_paid), 0)                       AS total_payments

FROM customers c

LEFT JOIN (
  SELECT DISTINCT ON (customer_id)
    customer_id,
    balance_amount
  FROM invoices
  WHERE status = 'Approved'
  ORDER BY customer_id, id DESC
) latest
ON c.id::text = latest.customer_id

LEFT JOIN (
  SELECT
    customer_id,
    SUM(paid_amount) AS total_paid
  FROM invoices
  WHERE status = 'Approved'
  GROUP BY customer_id
) allinv
ON c.id::text = allinv.customer_id
    `;
    const vals = [];
    if (role !== 'chairman' && role !== 'mis-executive' && userId) {
      query += ` WHERE c.created_by = $1`;
      vals.push(userId);
    }
    const result = await pool.query(query, vals);
    return result.rows[0];
  }
};

module.exports = customerRepository;