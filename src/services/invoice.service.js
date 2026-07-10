const invoiceRepository = require('../repositories/invoice.repository');
const { generateInvoiceNumber, generateToken } = require('../models/invoice');
const emailService = require('./email.service');

const pool = require('../config/db');

const invoiceService = {

  getAllInvoices: async ({ role, userId }) => {
  const invoices = await invoiceRepository.getAll({ role, userId });
  const stats = await invoiceRepository.getStats();
  return { invoices, stats };
},

  createInvoice: async (data) => {
    const invoice_number = await generateInvoiceNumber();
    const chairman_token = generateToken();
    const invoice = await invoiceRepository.create({
      ...data,
      invoice_number,
      chairman_token,
    });
    await emailService.sendChairmanApprovalMail(invoice);
    return invoice;
  },

  // Chairman APPROVE — outstanding update అవుతుంది
  approveInvoice: async (token) => {
    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid token');
    if (invoice.status !== 'Pending') throw new Error('Already processed');

    const approved = await invoiceRepository.approve(token);

    // ✅ Customer outstanding update చేయి
   await pool.query(
  `UPDATE customers SET
    outstanding = outstanding + $2,
    total_payments = total_payments + $1,
    last_transaction = NOW()
   WHERE id = $3`,
 [
   approved.paid_amount || 0,
   approved.balance_amount || 0,
   approved.customer_id
 ]
);

    // ── Customer mail కి కావాల్సిన full details fetch చేయి (Bill To section) ──
    // approved.customer_id ఇక్కడ customers.id (numeric FK), display Client ID కాదు
    let customerDetails = {};
    try {
      const custRes = await pool.query(
        `SELECT customer_id, phone, address, city, state, gstin
         FROM customers WHERE id = $1`,
        [approved.customer_id]
      );
      if (custRes.rows.length > 0) {
        customerDetails = custRes.rows[0];
      }
    } catch (err) {
      console.log('⚠️ Could not fetch customer details for mail:', err.message);
    }

    const mailPayload = {
      ...approved,
      customer_id: customerDetails.customer_id || approved.customer_id,
      customer_phone: customerDetails.phone || approved.customer_phone,
      customer_address: customerDetails.address
        ? `${customerDetails.address}${customerDetails.city ? ', ' + customerDetails.city : ''}${customerDetails.state ? ', ' + customerDetails.state : ''}`
        : approved.customer_address,
      customer_gstin: customerDetails.gstin || approved.customer_gstin,
      customer_country: customerDetails.country || approved.customer_country || 'India',
    };

    // Client కి mail పంపు
    await emailService.sendClientInvoiceMail(mailPayload);
    return approved;
  },

  // Chairman REJECT
  rejectInvoice: async (token) => {
    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid token');
    if (invoice.status !== 'Pending') throw new Error('Already processed');
    return await invoiceRepository.reject(token);
  },

  // ─── NEW: Dashboard "Download PDF" ───────────────────────
  getInvoicePdfBuffer: async (invoiceId) => {
     const pdfService = require('./pdf.service'); 
    const invoice = await invoiceRepository.getById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    let customerDetails = {};
    try {
      const custRes = await pool.query(
        `SELECT customer_id, phone, address, city, state, gstin
         FROM customers WHERE id = $1`,
        [invoice.customer_id]
      );
      if (custRes.rows.length > 0) {
        customerDetails = custRes.rows[0];
      }
    } catch (err) {
      console.log('⚠️ Could not fetch customer details for PDF:', err.message);
    }

    const payload = {
      ...invoice,
      customer_id: customerDetails.customer_id || invoice.customer_id,
      customer_phone: customerDetails.phone || invoice.customer_phone,
      customer_address: customerDetails.address
        ? `${customerDetails.address}${customerDetails.city ? ', ' + customerDetails.city : ''}${customerDetails.state ? ', ' + customerDetails.state : ''}`
        : invoice.customer_address,
      customer_gstin: customerDetails.gstin || invoice.customer_gstin,
      customer_country: customerDetails.country || invoice.customer_country || 'India',
    };

    const html = emailService.buildClientInvoiceHtml(payload);
    const pdfBuffer = await pdfService.generatePdfFromHtml(html);

    return { pdfBuffer, invoice_number: invoice.invoice_number };
  },
};

module.exports = invoiceService;