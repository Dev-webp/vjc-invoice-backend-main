const pool = require('../config/db');

// ── Generate REC-XXXXXX ──────────────────────────────────────
const generateProfileNo = async () => {
  const result = await pool.query(
    "SELECT profile_no FROM recurring_invoices ORDER BY id DESC LIMIT 1"
  );
  if (result.rows.length === 0) return "REC-000001";
  const last = result.rows[0].profile_no;
  const num  = parseInt(last.replace("REC-", ""), 10) + 1;
  return `REC-${String(num).padStart(6, "0")}`;
};

// ── Get All ──────────────────────────────────────────────────
const getAll = async () => {
  const result = await pool.query(
    "SELECT * FROM recurring_invoices ORDER BY id DESC"
  );
  return result.rows;
};

// ── Get By ID ────────────────────────────────────────────────
const getById = async (id) => {
  const result = await pool.query(
    "SELECT * FROM recurring_invoices WHERE id = $1", [id]
  );
  return result.rows[0];
};

// ── Create ───────────────────────────────────────────────────
const create = async (data) => {
  const profileNo = await generateProfileNo();
  const {
    profile_name, customer_id, customer_name,
    frequency, payment_terms, start_date, end_date,
    no_end_date, next_invoice_date, notes, line_items,
  } = data;

  const result = await pool.query(
    `INSERT INTO recurring_invoices
      (profile_no, profile_name, customer_id, customer_name,
       frequency, payment_terms, start_date, end_date,
       no_end_date, last_invoice_date, next_invoice_date,
       status, notes, line_items, generated_invoices)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             'Active',$12,$13,'[]')
     RETURNING *`,
    [
      profileNo, profile_name, customer_id, customer_name,
      frequency, payment_terms || "Net 30",
      start_date, end_date || null,
      no_end_date ?? true,
      start_date,
      next_invoice_date || null,
      notes || "",
      JSON.stringify(line_items || []),
    ]
  );
  return result.rows[0];
};

// ── Update ───────────────────────────────────────────────────
const update = async (id, data) => {
  const {
    profile_name, customer_id, customer_name,
    frequency, payment_terms, start_date, end_date,
    no_end_date, next_invoice_date, notes, line_items,
  } = data;

  const result = await pool.query(
    `UPDATE recurring_invoices SET
      profile_name=$1, customer_id=$2, customer_name=$3,
      frequency=$4, payment_terms=$5, start_date=$6,
      end_date=$7, no_end_date=$8, next_invoice_date=$9,
      notes=$10, line_items=$11, updated_at=CURRENT_TIMESTAMP
     WHERE id=$12 RETURNING *`,
    [
      profile_name, customer_id, customer_name,
      frequency, payment_terms, start_date,
      end_date || null, no_end_date ?? true,
      next_invoice_date || null,
      notes || "",
      JSON.stringify(line_items || []),
      id,
    ]
  );
  return result.rows[0];
};

// ── Stop ─────────────────────────────────────────────────────
const stop = async (id) => {
  const result = await pool.query(
    `UPDATE recurring_invoices
     SET status='Stopped', next_invoice_date=NULL,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

// ── Resume ───────────────────────────────────────────────────
const resume = async (id, next_invoice_date) => {
  const result = await pool.query(
    `UPDATE recurring_invoices
     SET status='Active', next_invoice_date=$1,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=$2 RETURNING *`,
    [next_invoice_date, id]
  );
  return result.rows[0];
};

// ── Add Generated Invoice ─────────────────────────────────────
const addGeneratedInvoice = async (id, invoice) => {
  const cur = await pool.query(
    "SELECT generated_invoices FROM recurring_invoices WHERE id=$1", [id]
  );
  const existing = cur.rows[0]?.generated_invoices || [];
  const updated  = [...existing, invoice];

  const result = await pool.query(
    `UPDATE recurring_invoices
     SET generated_invoices=$1, last_invoice_date=CURRENT_DATE,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=$2 RETURNING *`,
    [JSON.stringify(updated), id]
  );
  return result.rows[0];
};

// ── Delete ───────────────────────────────────────────────────
const remove = async (id) => {
  await pool.query(
    "DELETE FROM recurring_invoices WHERE id=$1", [id]
  );
  return { message: "Deleted" };
};

module.exports = {
  getAll, getById, create, update,
  stop, resume, addGeneratedInvoice, remove,
};