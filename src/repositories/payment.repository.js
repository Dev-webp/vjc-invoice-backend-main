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
  const {
  invoice_id,
  customer_id,
  customer_name,
  email,
  due_date,
  amount_due,
  amount_received,
  payment_method,
  payment_date,
  reference,
  paymentType,
  notes,
} = data;

const result = await pool.query(
    `INSERT INTO payments
      (payment_no, invoice_id, customer_id, customer_name, email,
       request_date, due_date, amount_due, amount_received,
       payment_method, txn_ref, paid_date, status, notes, reminder_log, created_by)
     VALUES (
$1,$2,$3,$4,$5,
CURRENT_DATE,
$6,
$7,
$8,
$9,
$10,
$11,
$12,
$13,
'[]',
$14
)
     RETURNING *`,
    [
  paymentNo,
  invoice_id || null,
  customer_id,
  customer_name,
  email || "",
  due_date || null,

  paymentType === "Full Paid"
    ? Number(amount_due || amount_received || 0)
    : Number(amount_due),

  paymentType === "Full Paid"
    ? Number(amount_received || 0)
    : 0,

  paymentType === "Full Paid"
    ? payment_method || ""
    : "",

  paymentType === "Full Paid"
    ? reference || ""
    : "",

  paymentType === "Full Paid"
    ? payment_date || new Date()
    : null,

  paymentType === "Full Paid"
    ? "Paid"
    : "Initial Request",

  notes || "",

  data.created_by || null
]
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
  const {
    paymentDate,
    paymentMethod,
    amountReceived,
    reference,
    notes
  } = data;

  // Get the existing payment + linked invoice reference
  const cur = await pool.query(
    `SELECT amount_due, amount_received, invoice_id
     FROM payments
     WHERE id = $1`,
    [id]
  );

  if (cur.rows.length === 0) {
    throw new Error('Payment record not found');
  }

  const paymentRow = cur.rows[0];

  const invoiceRef = paymentRow.invoice_id;
  const received = Number(amountReceived || 0);

  // Keep the payment record cumulative.
  // Example:
  // First payment 30,000
  // Second payment 20,000
  // Stored amount_received becomes 50,000.
  const previousReceived = Number(paymentRow.amount_received || 0);
  const cumulativeReceived = previousReceived + received;

  // ------------------------------------------------------------
  // Find the actual invoice.
  // invoice_id in the existing payment flow may contain either
  // the invoice DB id or the invoice number, so support both.
  // ------------------------------------------------------------
  let invoice = null;

  if (invoiceRef !== null && invoiceRef !== undefined && invoiceRef !== '') {
    const invoiceResult = await pool.query(
      `SELECT *
       FROM invoices
       WHERE id::text = $1
          OR invoice_number = $1
       LIMIT 1`,
      [String(invoiceRef)]
    );

    invoice = invoiceResult.rows[0] || null;
  }

  // Fallback to the payment amount if no invoice was found.
  const amountDue = Number(
    invoice?.grand_total ||
    invoice?.total_amount ||
    paymentRow.amount_due ||
    0
  );

  const newPaidAmount = Math.min(cumulativeReceived, amountDue);
  const newBalanceAmount = Math.max(amountDue - newPaidAmount, 0);

  const newStatus =
    newBalanceAmount <= 0
      ? "Paid"
      : newPaidAmount > 0
        ? "Partially Paid"
        : "Initial Request";

  // ------------------------------------------------------------
  // Update payment record
  // ------------------------------------------------------------
  const result = await pool.query(
    `UPDATE payments
     SET amount_received = $1,
         payment_method = $2,
         txn_ref = $3,
         paid_date = $4,
         notes = COALESCE(NULLIF($5,''), notes),
         status = $6,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $7
     RETURNING *`,
    [
      cumulativeReceived,
      paymentMethod,
      reference || "",
      paymentDate || null,
      notes || "",
      newStatus,
      id
    ]
  );

  // ------------------------------------------------------------
  // Update Invoice
  // ------------------------------------------------------------
  let updatedInvoice = invoice;

  if (invoice) {
    const invoiceUpdate = await pool.query(
      `UPDATE invoices
       SET paid_amount = $1,
           balance_amount = $2
       WHERE id = $3
       RETURNING *`,
      [
        newPaidAmount,
        newBalanceAmount,
        invoice.id
      ]
    );

    updatedInvoice = invoiceUpdate.rows[0] || invoice;
  }

  // ------------------------------------------------------------
  // Sync the SAME invoice lead to OPS
  // Only if this invoice was already sent to Ops.
  // ------------------------------------------------------------
  if (updatedInvoice?.sent_to_ops && updatedInvoice?.invoice_number) {
    try {
      const axios = require('axios');

      const paymentStatus =
        newBalanceAmount <= 0
          ? 'Paid'
          : newPaidAmount > 0
            ? 'Partial'
            : 'Pending';

      await axios.patch(
        `${process.env.OPS_PORTAL_API_URL}/api/leads/from-invoice/payment-sync`,
        {
          invoice_number: updatedInvoice.invoice_number,
          total_amount: Number(updatedInvoice.total_amount || amountDue),
          paid_amount: newPaidAmount,
          outstanding_amount: newBalanceAmount,
          payment_status: paymentStatus,
        },
        {
          headers: {
            'x-internal-key': process.env.OPS_INTERNAL_API_KEY
          }
        }
      );

      console.log(
        `✅ OPS payment sync successful for ${updatedInvoice.invoice_number}`
      );
    } catch (err) {
      // Do not break the Invoice payment operation if OPS is temporarily unavailable.
      console.error(
        `⚠️ OPS payment sync failed for ${updatedInvoice.invoice_number}:`,
        err.message
      );
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
