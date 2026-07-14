// ============================================================
// FILE: VJC-Invoice-backend/src/repositories/payment.repository.js
// ============================================================

const pool = require('../config/db');  // ← salesInvoice same ga — no destructuring

// ── Generate next PAY-XXXXXX ─────────────────────────────────
const generatePaymentNo = async (userId) => {
  const result = await pool.query(
    "SELECT payment_no FROM payments WHERE created_by = $1 ORDER BY id DESC LIMIT 1",
    [userId]
  );
  if (result.rows.length === 0) return "PAY-000001";
  const last = result.rows[0].payment_no;
  const num  = parseInt(last.replace("PAY-", ""), 10) + 1;
  return `PAY-${String(num).padStart(6, "0")}`;
};

// ── Get All ──────────────────────────────────────────────────
const getAllPayments = async ({ role, userId } = {}) => {
  let query = "SELECT * FROM payments";
  const vals = [];
  if (role !== 'chairman' && role !== 'mis-executive' && userId) {
    query += " WHERE created_by = $1";
    vals.push(userId);
  }
  query += " ORDER BY id DESC";
  const result = await pool.query(query, vals);
  return result.rows;
};

// ── Get by DB id ─────────────────────────────────────────────
const getPaymentById = async (id) => {
  const result = await pool.query(
    "SELECT * FROM payments WHERE id = $1", [id]
  );
  return result.rows[0];
};

// ── Create ───────────────────────────────────────────────────
const createPayment = async (data) => {
  const paymentNo = await generatePaymentNo(data.created_by);
  const { invoice_id, customer_id, customer_name, email, due_date, amount_due, notes } = data;

const result = await pool.query(
    `INSERT INTO payments
      (payment_no, invoice_id, customer_id, customer_name, email,
       request_date, due_date, amount_due, amount_received,
       payment_method, txn_ref, paid_date, status, notes, reminder_log, created_by)
     VALUES ($1,$2,$3,$4,$5, CURRENT_DATE,$6,$7,0,'','',NULL,
             'Initial Request',$8,'[]',$9)
     RETURNING *`,
    [paymentNo, invoice_id || null, customer_id, customer_name,
     email || "", due_date || null, Number(amount_due), notes || "",
     data.created_by || null]
  );
  return result.rows[0];
};

// ── Send Reminder ─────────────────────────────────────────────
const sendReminder = async (id, newStage, method, note) => {
  const cur = await pool.query(
    "SELECT reminder_log FROM payments WHERE id=$1", [id]
  );
  const log = cur.rows[0]?.reminder_log || [];
  const newLog = [...log, {
    stage: newStage,
    date:  new Date().toISOString().split("T")[0],
    method,
    note: note || "",
  }];

  const result = await pool.query(
    `UPDATE payments
     SET status=$1, reminder_log=$2, updated_at=CURRENT_TIMESTAMP
     WHERE id=$3 RETURNING *`,
    [newStage, JSON.stringify(newLog), id]
  );
  return result.rows[0];
};

// ── Record Payment ────────────────────────────────────────────
const recordPayment = async (id, data) => {
  const { paymentDate, paymentMethod, amountReceived, reference, notes } = data;

  const cur = await pool.query(
    "SELECT amount_due, invoice_id FROM payments WHERE id=$1", [id]
  );
  const amountDue = Number(cur.rows[0]?.amount_due || 0);
  const invoiceId = cur.rows[0]?.invoice_id;
  const received  = Number(amountReceived);
  const newStatus = received >= amountDue ? "Paid"
                  : received > 0          ? "Partially Paid"
                  : "Initial Request";

  const result = await pool.query(
    `UPDATE payments
     SET amount_received=$1, payment_method=$2, txn_ref=$3,
         paid_date=$4, notes=COALESCE(NULLIF($5,''), notes),
         status=$6, updated_at=CURRENT_TIMESTAMP
     WHERE id=$7 RETURNING *`,
    [received, paymentMethod, reference || "",
     paymentDate || null, notes || "", newStatus, id]
  );

  // 🔗 keep the linked invoice in sync when fully paid
  if (newStatus === "Paid" && invoiceId) {
    const invoiceRepo = require('./invoice.repository');
    try {
      await invoiceRepo.markPaidByInvoiceNumber(invoiceId);
    } catch (err) {
      console.error('Invoice sync error:', err.message);
    }
  }

  return result.rows[0];
};
// ── Void ──────────────────────────────────────────────────────
const voidPayment = async (id) => {
  const result = await pool.query(
    `UPDATE payments SET status='Void', updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING *`, [id]
  );
  return result.rows[0];
};

// ── Delete ────────────────────────────────────────────────────
const deletePayment = async (id) => {
  await pool.query("DELETE FROM payments WHERE id=$1", [id]);
  return { message: "Payment deleted" };
};

module.exports = {
  getAllPayments, getPaymentById, createPayment,
  sendReminder, recordPayment, voidPayment, deletePayment,
};
