const repo = require('../repositories/timetracking.repository');
const { generateLogNo } = require('../models/timetracking');
const invoiceRepository = require('../repositories/invoice.repository');
const { generateInvoiceNumber, generateToken } = require('../models/invoice');
const emailService = require('./email.service');
const pool = require('../config/db');

const timeTrackingService = {

  // ── Projects ──
  getAllProjects: async () => repo.getAllProjects(),

  createProject: async (data) => repo.createProject(data),

  // ── Time Logs ──
  getAllData: async () => {
    const logs = await repo.getAllLogs();
    const projects = await repo.getAllProjects();
    const stats = await repo.getStats();
    return { logs, projects, stats };
  },

  createLog: async (data) => {
    const log_no = await generateLogNo();
    return await repo.createLog({ ...data, log_no });
  },

  updateLog: async (id, data) => {
    const log = await repo.getLogById(id);
    if (!log) throw new Error('Time log not found');
    return await repo.updateLog(id, data);
  },

  deleteLog: async (id) => {
    const log = await repo.getLogById(id);
    if (!log) throw new Error('Time log not found');
    return await repo.deleteLog(id);
  },

  // ── Convert to Invoice ──
  convertToInvoice: async (id) => {
    const log = await repo.getLogById(id);
    if (!log) throw new Error('Time log not found');
    if (log.invoiced) throw new Error('Already invoiced');
    if (!log.billable) throw new Error('Non-billable log cannot be invoiced');

    // Customer details fetch చేయి
    const custRes = await pool.query('SELECT * FROM customers WHERE id=$1', [log.customer_id]);
    const customer = custRes.rows[0];
    if (!customer) throw new Error('Customer not found');

    const amount = Number(log.hours) * Number(log.hourly_rate);
    const cgst = amount * 0.09;
    const sgst = amount * 0.09;
    const total_amount = amount + cgst + sgst;

    const invoice_number = await generateInvoiceNumber();
    const chairman_token = generateToken();

    const invoice = await invoiceRepository.create({
      invoice_number,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_gstin: customer.gstin,
      customer_address: `${customer.address || ""}, ${customer.city || ""}, ${customer.state || ""}`,
      items: [{
        service: "Time Tracking",
        description: log.task,
        qty: 1,
        rate: amount,
        amount: amount,
      }],
      subtotal: amount,
      tax_percent: 18,
      tax_amount: cgst + sgst,
      cgst,
      sgst,
      total_amount,
      due_date: null,
      notes: `Time log: ${log.log_no} (${log.hours} hrs @ ₹${log.hourly_rate}/hr)`,
      chairman_token,
      logo: null,
    });

    await repo.markInvoiced(id, invoice.id);

    // Chairman కి approval mail
    await emailService.sendChairmanApprovalMail(invoice);

    return invoice;
  },
};

module.exports = timeTrackingService;