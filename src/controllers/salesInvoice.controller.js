const salesInvoiceRepo = require('../repositories/salesInvoice.repository');
const { generateSalesInvoiceId } = require('../models/salesInvoice');

const getSalesInvoices = async (req, res) => {
  try {
    const invoices = await salesInvoiceRepo.getAllSalesInvoices();
    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSalesInvoiceById = async (req, res) => {
  try {
    const invoice = await salesInvoiceRepo.getSalesInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createSalesInvoice = async (req, res) => {
  try {
    const invoice_id = await generateSalesInvoiceId();
    const invoice = await salesInvoiceRepo.createSalesInvoice({ ...req.body, invoice_id });
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateSalesInvoice = async (req, res) => {
  try {
    const invoice = await salesInvoiceRepo.updateSalesInvoice(req.params.id, req.body);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateSalesInvoiceStatus = async (req, res) => {
  try {
    const { status, paid_amount } = req.body;
    const invoice = await salesInvoiceRepo.updateSalesInvoiceStatus(req.params.id, status, paid_amount);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteSalesInvoice = async (req, res) => {
  try {
    await salesInvoiceRepo.deleteSalesInvoice(req.params.id);
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSalesInvoices,
  getSalesInvoiceById,
  createSalesInvoice,
  updateSalesInvoice,
  updateSalesInvoiceStatus,
  deleteSalesInvoice,
};