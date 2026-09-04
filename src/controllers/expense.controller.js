const repo = require("../repositories/expense.repository");

const getAll = async (req, res) => {
  try {
    res.json(await repo.getAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await repo.getById(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const create = async (req, res) => {
  try {
    res.status(201).json(await repo.create(req.body));
  } catch (err) {
    console.error("create expense error:", err);
    res.status(500).json({ error: err.message });
  }
};

const update = async (req, res) => {
  try {
    res.json(await repo.update(req.params.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const convertToInvoice = async (req, res) => {
  try {
    res.json(await repo.convertToInvoice(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const reimburse = async (req, res) => {
  try {
    res.json(await repo.reimburse(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    res.json(await repo.remove(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// ── NEW: due/overdue unpaid expenses — feeds the top-right bell ─────────
const getDueNotifications = async (req, res) => {
  try {
    res.json(await repo.getDueUnpaidExpenses());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── NEW: receipt file upload (local disk storage via multer) ────────────
const uploadReceipt = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const fileUrl = `/uploads/receipts/${req.file.filename}`;
    res.json({ url: fileUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
module.exports = {
  getAll, getById, create, update,
  convertToInvoice, reimburse, remove,
  getDueNotifications, uploadReceipt,
};