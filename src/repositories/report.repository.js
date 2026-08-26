const pool = require('../config/db');

// 1. Sales by Customer
const salesByCustomer = async ({ role, userId } = {}) => {
 const whereClause = '';

  const result = await pool.query(`
  SELECT
    u.name AS person,
    u.email AS email,
    COUNT(i.id) AS invoices,
    COALESCE(SUM(i.total_amount), 0) AS amount,
    COALESCE(SUM(i.paid_amount), 0) AS paid,
    COALESCE(SUM(i.balance_amount), 0) AS pending
  FROM users u
  LEFT JOIN invoices i
    ON i.created_by = u.id
    ${dateFilter}
  WHERE u.role != 'chairman'
  ${userFilter}
  GROUP BY u.id, u.name, u.email
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
const salesBySalesPerson = async ({ role, userId, year, month, day } = {}) => {
  let dateFilter = '';
  if (year)  dateFilter += ` AND EXTRACT(YEAR FROM i.invoice_date) = ${Number(year)}`;
  if (month) dateFilter += ` AND EXTRACT(MONTH FROM i.invoice_date) = ${Number(month)}`;
  if (day)   dateFilter += ` AND EXTRACT(DAY FROM i.invoice_date) = ${Number(day)}`;

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
    LEFT JOIN invoices i
      ON i.created_by = u.id
      AND i.status = 'Approved'
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

// 9. Lead Source Report — leads received per source
const leadSourceReport = async ({ role, userId, year, month, day } = {}) => {
  let dateFilter = '';
  if (year)  dateFilter += ` AND EXTRACT(YEAR FROM l.created_at) = ${Number(year)}`;
  if (month) dateFilter += ` AND EXTRACT(MONTH FROM l.created_at) = ${Number(month)}`;
  if (day)   dateFilter += ` AND EXTRACT(DAY FROM l.created_at) = ${Number(day)}`;

  const userFilter = (role !== 'chairman' && role !== 'mis-executive' && userId)
    ? ` AND (l.created_by = ${Number(userId)} OR l.assigned_to = ${Number(userId)})`
    : '';

  const result = await pool.query(`
    SELECT
      l.source AS source,
      COUNT(*) AS count,
      COUNT(*) FILTER (WHERE l.status = 'Closed') AS closed
    FROM leads l
    WHERE 1=1
    ${dateFilter}
    ${userFilter}
    GROUP BY l.source
    ORDER BY count DESC
  `);
  return result.rows.map(r => ({
    source: r.source || 'Unknown',
    count: Number(r.count),
    closed: Number(r.closed),
    conversionRate: Number(r.count) > 0
      ? `${Math.round((Number(r.closed) / Number(r.count)) * 100)}%`
      : '0%',
  }));
};

// 10. Agent Performance Report — leads closed + red flags per agent
const agentPerformanceReport = async ({ role, userId, year, month, day } = {}) => {
  let dateFilter = '';
  if (year)  dateFilter += ` AND EXTRACT(YEAR FROM l.created_at) = ${Number(year)}`;
  if (month) dateFilter += ` AND EXTRACT(MONTH FROM l.created_at) = ${Number(month)}`;
  if (day)   dateFilter += ` AND EXTRACT(DAY FROM l.created_at) = ${Number(day)}`;

  const userFilter = (role !== 'chairman' && role !== 'mis-executive' && userId)
    ? ` AND u.id = ${Number(userId)}`
    : '';

  const result = await pool.query(`
    SELECT
      u.name AS agent,
      COUNT(l.id) AS total_leads,
      COUNT(l.id) FILTER (WHERE l.status = 'Closed') AS closed,
      COALESCE((
        SELECT COUNT(*) FROM agent_red_flags rf WHERE rf.staff_id = u.id
      ), 0) AS red_flags
    FROM users u
    LEFT JOIN leads l
      ON l.assigned_to = u.id
      ${dateFilter}
    WHERE u.role != 'chairman'
    ${userFilter}
    GROUP BY u.id, u.name
    ORDER BY total_leads DESC
  `);
  return result.rows.map(r => ({
    agent: r.agent,
    totalLeads: Number(r.total_leads),
    closed: Number(r.closed),
    redFlags: Number(r.red_flags),
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
  leadSourceReport,
  agentPerformanceReport,
};