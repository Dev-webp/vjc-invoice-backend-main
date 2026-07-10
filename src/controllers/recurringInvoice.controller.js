const repo = require("../repositories/recurringInvoice.repository");

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
    console.error("create recurring error:", err);
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

const stop = async (req, res) => {
  try {
    res.json(await repo.stop(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const resume = async (req, res) => {
  try {
    const { next_invoice_date } = req.body;
    res.json(await repo.resume(req.params.id, next_invoice_date));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const addGeneratedInvoice = async (req, res) => {
  try {
    res.json(await repo.addGeneratedInvoice(req.params.id, req.body));
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

module.exports = {
  getAll, getById, create, update,
  stop, resume, addGeneratedInvoice, remove,
};