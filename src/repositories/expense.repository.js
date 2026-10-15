const pool = require('../config/db');

// ── Generate EXP-XXXXXX ──────────────────────────────────────
const generateExpenseNo = async () => {
  const result = await pool.query(
    "SELECT expense_no FROM expenses ORDER BY id DESC LIMIT 1"
  );
  if (result.rows.length === 0) return "EXP-001";
  const last = result.rows[0].expense_no;
  const num  = parseInt(last.replace("EXP-", ""), 10) + 1;
  return `EXP-${String(num).padStart(3, "0")}`;
};

// ── Get All ──────────────────────────────────────────────────
const getAll = async () => {
  const result = await pool.query(
    "SELECT * FROM expenses ORDER BY id DESC"
  );
  return result.rows;
};

// ── Get By ID ────────────────────────────────────────────────
const getById = async (id) => {
  const result = await pool.query(
    "SELECT * FROM expenses WHERE id=$1", [id]
  );
  return result.rows[0];
};

// ── Create ───────────────────────────────────────────────────
const create = async (data) => {
  const expenseNo = await generateExpenseNo();
  const {
  date,
  category,
  customer,
  amount,
  billable,
  payment_status,
  notes,
  vendor_supplier,
  payment_date,
  payment_method,
  invoice_number,
  receipt_url,
  gst_applicable,
  gst_amount,
  department,
  paid_by,
  paid_by_name,
  due_date,
} = data;

const status = billable ? "Billable" : "Non Billable";

const result = await pool.query(
  `INSERT INTO expenses
    (
      expense_no,
      date,
      category,
      customer,
      amount,
      billable,
      status,
      payment_status,
      notes,
      vendor_supplier,
      payment_date,
      payment_method,
      invoice_number,
      receipt_url,
      gst_applicable,
      gst_amount,
      department,
      paid_by,
      paid_by_name,
      due_date
    )
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
   RETURNING *`,
  [
    expenseNo,
    date,
    category,
    customer || "VJC",
    Number(amount),
    billable,
    status,
    payment_status || "Unpaid",
    notes || "",
    vendor_supplier || null,
    payment_date || date || null,
    payment_method || null,
    invoice_number || null,
    receipt_url || null,
    !!gst_applicable,
    gst_amount ? Number(gst_amount) : 0,
    department || null,
    paid_by || "Company",
    paid_by_name || "VJC",
    due_date || null,
  ]
);
  return result.rows[0];
};
// ── Update ───────────────────────────────────────────────────
const update = async (id, data) => {
const {
  date,
  category,
  customer,
  amount,
  billable,
  payment_status,
  notes,
  vendor_supplier,
  payment_date,
  payment_method,
  invoice_number,
  receipt_url,
  gst_applicable,
  gst_amount,
  department,
  paid_by,
  paid_by_name,
  due_date,
} = data;

const result = await pool.query(
  `UPDATE expenses SET
       date=$1,
    category=$2,
    customer=$3,
    amount=$4,
    billable=$5,
    payment_status=$6,
    notes=$7,
    vendor_supplier=$8,
    payment_date=$9,
    payment_method=$10,
    invoice_number=$11,
    receipt_url=$12,
    gst_applicable=$13,
    gst_amount=$14,
    department=$15,
    paid_by=$16,
    paid_by_name=$17,
    due_date=$18,
    updated_at=CURRENT_TIMESTAMP
   WHERE id=$19 RETURNING *`,
  [
    date,
    category,
    customer || "VJC",
    Number(amount),
    billable,
    payment_status || "Unpaid",
    notes || "",
    vendor_supplier || null,
    payment_date || date || null,
    payment_method || null,
    invoice_number || null,
    receipt_url || null,
    !!gst_applicable,
    gst_amount ? Number(gst_amount) : 0,
    department || null,
    paid_by || "Company",
    paid_by_name || "VJC",
    due_date || null,
    id,
  ]
);
  return result.rows[0];
};

// ── Convert to Invoice ────────────────────────────────────────
const convertToInvoice = async (id) => {
  const result = await pool.query(
    `UPDATE expenses SET status='Invoiced', updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

// ── Reimburse ─────────────────────────────────────────────────
const reimburse = async (id) => {
  const result = await pool.query(
    `UPDATE expenses SET status='Reimbursed', updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

// ── Delete ───────────────────────────────────────────────────
const remove = async (id) => {
  await pool.query("DELETE FROM expenses WHERE id=$1", [id]);
  return { message: "Deleted" };
};
// ── NEW: Due / overdue unpaid expenses — feeds the notification bell ────
const getDueUnpaidExpenses = async () => {
  const result = await pool.query(
    `SELECT * FROM expenses
     WHERE payment_status = 'Unpaid'
       AND due_date IS NOT NULL
       AND due_date <= CURRENT_DATE
     ORDER BY due_date ASC`
  );
  return result.rows;
};
module.exports = {
  getAll, getById, create, update,
  convertToInvoice, reimburse, remove,
  getDueUnpaidExpenses,
};