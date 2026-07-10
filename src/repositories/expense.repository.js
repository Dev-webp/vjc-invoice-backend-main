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
  const { date, category, customer, amount, billable, notes } = data;
  const status = billable ? "Billable" : "Non Billable";

  const result = await pool.query(
    `INSERT INTO expenses
      (expense_no, date, category, customer, amount, billable, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      expenseNo, date, category,
      customer || "-",
      Number(amount),
      billable,
      status,
      notes || "",
    ]
  );
  return result.rows[0];
};

// ── Update ───────────────────────────────────────────────────
const update = async (id, data) => {
  const { date, category, customer, amount, billable, notes } = data;

  const result = await pool.query(
    `UPDATE expenses SET
      date=$1, category=$2, customer=$3,
      amount=$4, billable=$5, notes=$6,
      updated_at=CURRENT_TIMESTAMP
     WHERE id=$7 RETURNING *`,
    [
      date, category,
      customer || "-",
      Number(amount),
      billable,
      notes || "",
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

module.exports = {
  getAll, getById, create, update,
  convertToInvoice, reimburse, remove,
};