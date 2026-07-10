// ============================================================
// FILE: VJC-Invoice-backend/src/controllers/payment.controller.js
// ============================================================

const repo = require("../repositories/payment.repository");
const emailService = require("../services/email.service");

// GET /api/payments
const getAll = async (req, res) => {
  try {
    const role   = req.user?.role;
    const userId = req.user?.id;
    const data = await repo.getAllPayments({ role, userId });
    res.json(data);
  } catch (err) {
    console.error("getAll payments error:", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/payments/:id
const getById = async (req, res) => {
  try {
    const data = await repo.getPaymentById(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/payments
const create = async (req, res) => {
  try {

    console.log("PAYMENT REQUEST BODY =>", req.body);

    const data = await repo.createPayment({
      ...req.body,
      created_by: req.user?.id,
  
    });
    res.status(201).json(data);
  } catch (err) {
    console.error("create payment error:", err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/payments/:id/reminder
const remind = async (req, res) => {
  try {
    const { newStage, method, note } = req.body;
    const data = await repo.sendReminder(req.params.id, newStage, method, note);

    // 🔔 send actual email to customer, if they have an email on file
    if (data?.email) {
      try {
        await emailService.sendPaymentReminderMail(data, newStage, note);
      } catch (mailErr) {
        console.error("PAYMENT REMINDER MAIL ERROR:", mailErr.message);
      }
    } else {
      console.warn("⚠️ Reminder mail skipped — no email on payment id:", req.params.id);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/payments/:id/record
const record = async (req, res) => {
  try {
    const data = await repo.recordPayment(req.params.id, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/payments/:id/void
const voidPay = async (req, res) => {
  try {
    const data = await repo.voidPayment(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/payments/:id
const remove = async (req, res) => {
  try {
    const data = await repo.deletePayment(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getAll, getById, create, remind, record, voidPay, remove };
