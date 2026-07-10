const pool = require('../config/db');

// 1. Sales by Customer
const salesByCustomer = async ({ role, userId } = {}) => {
 const whereClause = '';

  const result = await pool.query(`
    SELECT
      i.customer_name AS customer,
      COUNT(i.id) AS invoices,
      COALESCE(SUM(i.total_amount), 0) AS amount,
      COALESCE(SUM(p.amount_received), 0) AS paid
    FROM invoices i
    LEFT JOIN payments p
      ON p.customer_name = i.customer_name
    ${whereClause}
    GROUP BY i.customer_name
    ORDER BY amount DESC
  `);

  return result.rows.map(r => ({
    customer: r.customer,
    invoices: Number(r.invoices),
    amount: Number(r.amount),
    paid: Number(r.paid),
    outstanding: Number(r.amount) - Number(r.paid),
  }));
};

// 2. Sales by Item (unnest line_items jsonb)
const salesByItem = async ({ role, userId } = {}) => {
  const whereClause = (role !== 'chairman' && role !== 'mis-executive' && userId)
    ? `WHERE created_by = '${userId}'`
    : '';

  const result = await pool.query(`
    SELECT
      COALESCE(NULLIF(TRIM(service_type), ''), 'Other') AS item,
      COUNT(*) AS qty,
      COALESCE(SUM(total_amount), 0) AS amount,
      COALESCE(SUM(paid_amount), 0) AS paid,
      COALESCE(SUM(balance_amount), 0) AS pending
    FROM invoices
    ${whereClause}
    GROUP BY item
    ORDER BY amount DESC
  `);
  return result.rows.map(r => ({
    item: r.item,
    qty: Number(r.qty),
    amount: Number(r.amount),
    paid: Number(r.paid),
    pending: Number(r.pending),
    avgPrice:
      Number(r.qty) > 0
        ? Math.round(Number(r.amount) / Number(r.qty))
        : 0,
  }));
};

// 3. Invoice Details
const invoiceDetails = async ({ role, userId } = {}) => {
  const whereClause = (role !== 'chairman' && role !== 'mis-executive' && userId)
    ? `WHERE created_by = '${userId}'`
    : '';

  const result = await pool.query(`
    SELECT
      invoice_number,
      customer_name,
      invoice_date,
      due_date,
      total_amount,
      paid_amount,
      balance_amount,
      status
    FROM invoices
    ${whereClause}
    ORDER BY created_at DESC
  `);

  return result.rows.map(r => ({
    invoiceNo: r.invoice_number,
    customer: r.customer_name,
    date: r.invoice_date ? new Date(r.invoice_date).toISOString().slice(0, 10) : '',
    dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '',
    amount: Number(r.total_amount || 0),
    paid: Number(r.paid_amount || 0),
    balance: Number(r.balance_amount || 0),
    status: r.status || '',
  }));
};
// 4. Quote Details
const quoteDetails = async () => {
  const result = await pool.query(`
    SELECT quote_id, customer_name, quote_date, expiry_date, total_amount, status
    FROM quotes
    ORDER BY quote_date DESC
  `);
  return result.rows.map(r => ({
    quoteNo: r.quote_id,
    customer: r.customer_name,
    date: r.quote_date ? r.quote_date.toISOString().slice(0, 10) : '',
    expiryDate: r.expiry_date ? r.expiry_date.toISOString().slice(0, 10) : '',
    amount: Number(r.total_amount),
    status: r.status,
  }));
};

// 5. Payments Received
const paymentsReceived = async () => {
  const result = await pool.query(`
    SELECT p.paid_date, c.name AS customer_name, p.invoice_id, p.payment_method, p.amount_received
    FROM payments p
    LEFT JOIN customers c ON c.customer_id = p.customer_id
    WHERE p.amount_received IS NOT NULL AND p.amount_received > 0
    ORDER BY p.paid_date DESC
  `);
  return result.rows.map(r => ({
    date: r.paid_date ? new Date(r.paid_date).toISOString().slice(0, 10) : '',
    customer: r.customer_name || '—',
    invoiceNo: r.invoice_id || '—',
    mode: r.payment_method || '—',
    amount: Number(r.amount_received || 0),
  }));
};

// 6. AR Aging Summary
const arAgingSummary = async () => {
  const result = await pool.query(`
    SELECT
      customer_name AS customer,
      COALESCE(SUM(CASE WHEN due_date >= CURRENT_DATE THEN total_amount ELSE 0 END), 0) AS current,
      COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE AND (CURRENT_DATE - due_date) <= 30 THEN total_amount ELSE 0 END), 0) AS days30,
      COALESCE(SUM(CASE WHEN (CURRENT_DATE - due_date) > 30 AND (CURRENT_DATE - due_date) <= 60 THEN total_amount ELSE 0 END), 0) AS days60,
      COALESCE(SUM(CASE WHEN (CURRENT_DATE - due_date) > 60 THEN total_amount ELSE 0 END), 0) AS days90,
      COALESCE(SUM(total_amount), 0) AS total
    FROM sales_invoices
    WHERE status NOT IN ('Paid','Cancelled','Draft')
    GROUP BY customer_name
    ORDER BY total DESC
  `);
  return result.rows.map(r => ({
    customer: r.customer,
    current: Number(r.current),
    days30: Number(r.days30),
    days60: Number(r.days60),
    days90: Number(r.days90),
    total: Number(r.total),
  }));
};

// 7. Customer Balance Summary
const customerBalanceSummary = async () => {
  const result = await pool.query(`
    SELECT customer_id, name, outstanding, total_payments
    FROM customers
    ORDER BY outstanding DESC
  `);
  return result.rows.map(r => ({
    customerId: r.customer_id,
    customer: r.name,
    outstanding: Number(r.outstanding || 0),
    totalPayments: Number(r.total_payments || 0),
  }));
};

// 8. Sales by Sales Person
const salesBySalesPerson = async ({ role, userId, dateRange } = {}) => {
  const dateFilter = {
    today:       `AND DATE(i.invoice_date) = CURRENT_DATE`,
    thisWeek:    `AND DATE(i.invoice_date) >= DATE_TRUNC('week', CURRENT_DATE)`,
    thisMonth:   `AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)`,
    lastMonth:   `AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')`,
    thisQuarter: `AND DATE_TRUNC('quarter', i.invoice_date) = DATE_TRUNC('quarter', CURRENT_DATE)`,
    thisYear:    `AND DATE_TRUNC('year', i.invoice_date) = DATE_TRUNC('year', CURRENT_DATE)`,
  }[dateRange] || '';

  const userFilter = (role !== 'chairman' && role !== 'mis-executive' && userId)
    ? `AND u.id = ${userId}`
    : '';

  const result = await pool.query(`
    SELECT
      u.name AS person,
      u.email AS email,
      COUNT(i.id) AS invoices,
      COALESCE(SUM(i.total_amount), 0) AS amount,
      COALESCE(SUM(i.paid_amount), 0) AS paid,
      COALESCE(SUM(i.balance_amount), 0) AS pending
    FROM users u
    LEFT JOIN invoices i ON i.created_by = u.id
    ${dateFilter}
    WHERE u.role != 'chairman'
    ${userFilter}
    GROUP BY u.id, u.name, u.email
    ORDER BY amount DESC
  `);
  return result.rows.map(r => ({
    person: r.person,
    email: r.email,
    invoices: Number(r.invoices),
    amount: Number(r.amount),
    paid: Number(r.paid),
    pending: Number(r.pending),
  }));
};

module.exports = {
  salesByCustomer,
  salesByItem,
  invoiceDetails,
  quoteDetails,
  paymentsReceived,
  arAgingSummary,
  customerBalanceSummary,
  salesBySalesPerson,
};