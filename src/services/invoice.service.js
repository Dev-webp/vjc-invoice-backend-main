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
    const invoice_number = await generateInvoiceNumber(data.created_by);
    const chairman_token = generateToken();
    const invoice = await invoiceRepository.create({
      ...data,
      invoice_number,
      chairman_token,
    });

    // NEW — fetch sales consultant name for the chairman mail
    let salesConsultantName = '—';
    try {
      const userRes = await pool.query(`SELECT name FROM users WHERE id = $1`, [data.created_by]);
      if (userRes.rows.length > 0) salesConsultantName = userRes.rows[0].name;
    } catch (err) {
      console.log('⚠️ Could not fetch sales consultant name for mail:', err.message);
    }

    await emailService.sendChairmanApprovalMail({ ...invoice, sales_consultant: salesConsultantName });
    return invoice;
  },

  // Chairman APPROVE — outstanding update అవుతుంది
  approveInvoice: async (token) => {
    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid token');
    if (invoice.status !== 'Pending') throw new Error('Already processed');

    const approved = await invoiceRepository.approve(token);

    if (approved.is_discount_only) {
      return approved; // discount-only approval — no payment yet, skip customer update / client mail
    }

    // ✅ Customer outstanding update చేయి
      await pool.query(
  `UPDATE customers SET
    outstanding = outstanding + $2,
    total_payments = total_payments + $1,
    last_transaction = $4
   WHERE id = $3`,
 [
   approved.paid_amount || 0,
   approved.balance_amount || 0,
   approved.customer_id,
   approved.invoice_date
 ]
);

    // NEW — generate Agreement PDF once per customer (first approval only)
    await invoiceService._generateAgreementIfNeeded(approved);

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

// ✅ NEW: Dashboard-based Approve/Reject (chairman logged in, no token)
  getPendingInvoices: async () => {
    const invoices = await invoiceRepository.getPending();

    // NEW — attach sales consultant name (created_by → users.name)
    const userIds = [...new Set(invoices.map(i => i.created_by).filter(Boolean))];
    let usersMap = {};
    if (userIds.length > 0) {
      const usersRes = await pool.query(
        `SELECT id, name FROM users WHERE id = ANY($1)`,
        [userIds]
      );
      usersRes.rows.forEach(u => { usersMap[u.id] = u.name; });
    }

    return invoices.map(inv => ({
      ...inv,
      sales_consultant: usersMap[inv.created_by] || '—',
    }));
  },

    approveInvoiceById: async (id) => {
    const invoice = await invoiceRepository.getById(id);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'Pending') throw new Error('Already processed');

       const approved = await invoiceRepository.approveById(id);

    if (approved.is_discount_only) {
      return approved; // discount-only approval — no payment yet, skip customer update / client mail
    }

    await pool.query(
      `UPDATE customers SET
        outstanding = outstanding + $2,
        total_payments = total_payments + $1,
        last_transaction = $4
       WHERE id = $3`,
      [
        approved.paid_amount || 0,
        approved.balance_amount || 0,
        approved.customer_id,
        approved.invoice_date
      ]
    );

    // NEW — generate Agreement PDF once per customer (first approval only)
    await invoiceService._generateAgreementIfNeeded(approved);

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

    await emailService.sendClientInvoiceMail(mailPayload);
    return approved;
  },

  rejectInvoiceById: async (id) => {
    const invoice = await invoiceRepository.getById(id);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'Pending') throw new Error('Already processed');
    return await invoiceRepository.rejectById(id);
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

  // ✅ NEW: Chairman mail "View PDF" — token-based (no login), same PDF as client gets after approval
  getInvoicePdfBufferByToken: async (token) => {
    const pdfService = require('./pdf.service');
    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid or expired link');

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
      console.log('⚠️ Could not fetch customer details for preview PDF:', err.message);
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

  // NEW — internal helper: generate + mail Agreement PDF exactly once per customer
  _generateAgreementIfNeeded: async (approved) => {
    try {
      const custRes = await pool.query(
        `SELECT name, email, phone, address, city, state, service_type, agreement_generated
         FROM customers WHERE id = $1`,
        [approved.customer_id]
      );
      const cust = custRes.rows[0];
      if (!cust || cust.agreement_generated) return; // already generated — skip silently

      const agreementService = require('./agreement.service');
      const pdfService = require('./pdf.service');

      const agreementData = {
        customer_name: cust.name,
        customer_email: cust.email,
        customer_phone: cust.phone,
        customer_address: cust.address
          ? `${cust.address}${cust.city ? ', ' + cust.city : ''}${cust.state ? ', ' + cust.state : ''}`
          : '',
        service_type: cust.service_type || approved.service_type,
        total_amount: approved.total_amount,
        paid_amount: approved.paid_amount,
        balance_amount: approved.balance_amount,
        paid_date: approved.invoice_date,
        agreement_number: approved.invoice_number,
      };

      const html = agreementService.buildAgreementHtml(agreementData);
      const pdfBuffer = await pdfService.generatePdfFromHtml(html);

      await emailService.sendAgreementMail(agreementData, pdfBuffer);

      await pool.query(
        `UPDATE customers SET
          agreement_generated = true,
          agreement_total_amount = $1,
          agreement_number = $2,
          agreement_generated_at = NOW()
         WHERE id = $3`,
        [approved.total_amount, approved.invoice_number, approved.customer_id]
      );
    } catch (err) {
      console.log('⚠️ Agreement generation/mail failed (invoice approval NOT affected):', err.message);
    }
  },

  // NEW — Agreement PDF download (uses latest cumulative paid/balance from customers table)
  getAgreementPdfBuffer: async (invoiceId) => {
    const pdfService = require('./pdf.service');
    const agreementService = require('./agreement.service');

    const invoice = await invoiceRepository.getById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const custRes = await pool.query(
      `SELECT name, email, phone, address, city, state, service_type,
              agreement_generated, agreement_total_amount, agreement_number,
              outstanding, last_transaction
       FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.agreement_generated) {
      throw new Error('Agreement not yet generated for this customer');
    }

    const agreementData = {
      customer_name: cust.name,
      customer_email: cust.email,
      customer_phone: cust.phone,
      customer_address: cust.address
        ? `${cust.address}${cust.city ? ', ' + cust.city : ''}${cust.state ? ', ' + cust.state : ''}`
        : '',
      service_type: cust.service_type,
      total_amount: cust.agreement_total_amount,
      paid_amount: Number(cust.agreement_total_amount || 0) - Number(cust.outstanding || 0),
      balance_amount: cust.outstanding,
      paid_date: cust.last_transaction,
      agreement_number: cust.agreement_number,
    };

       const html = agreementService.buildAgreementHtml(agreementData);
    const pdfBuffer = await pdfService.generatePdfFromHtml(html);

    return { pdfBuffer, invoice_number: cust.agreement_number };
  },

  // NEW — Agreement PDF by chairman_token (no login needed). Reuses the same
  // token already generated for the approve/reject email links, so the Ops
  // Portal can show/download the agreement PDF without needing invoice-app
  // credentials.
  getAgreementPdfBufferByToken: async (token) => {
    const pdfService = require('./pdf.service');
    const agreementService = require('./agreement.service');

    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid or expired link');

    const custRes = await pool.query(
      `SELECT name, email, phone, address, city, state, service_type,
              agreement_generated, agreement_total_amount, agreement_number,
              outstanding, last_transaction
       FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.agreement_generated) {
      throw new Error('Agreement not yet generated for this customer');
    }

    const agreementData = {
      customer_name: cust.name,
      customer_email: cust.email,
      customer_phone: cust.phone,
      customer_address: cust.address
        ? `${cust.address}${cust.city ? ', ' + cust.city : ''}${cust.state ? ', ' + cust.state : ''}`
        : '',
      service_type: cust.service_type,
      total_amount: cust.agreement_total_amount,
      paid_amount: Number(cust.agreement_total_amount || 0) - Number(cust.outstanding || 0),
      balance_amount: cust.outstanding,
      paid_date: cust.last_transaction,
      agreement_number: cust.agreement_number,
    };

    const html = agreementService.buildAgreementHtml(agreementData);
    const pdfBuffer = await pdfService.generatePdfFromHtml(html);

    return { pdfBuffer, invoice_number: cust.agreement_number };
  },

  // NEW — "Send to Ops": pushes an approved invoice's student + payment
  // details to the Ops Portal so the Counselor can review and confirm it as
  // a real lead. Does NOT touch anything in the invoice app's own data
  // model except marking the invoice as sent (sent_to_ops / sent_to_ops_at)
  // so the button can't be double-clicked into sending twice.
  sendToOps: async (invoiceId, requestingUserId) => {
    const axios = require('axios');

    const invoice = await invoiceRepository.getById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'Approved') {
      throw new Error('Only an approved invoice can be sent to Ops');
    }
    if (invoice.sent_to_ops) {
      throw new Error('This invoice has already been sent to Ops');
    }

    const custRes = await pool.query(
      `SELECT phone, service_type, agreement_generated FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.agreement_generated) {
      throw new Error('Agreement not yet generated for this customer — cannot send to Ops yet');
    }

    // The counselor who created this invoice — Ops Portal matches this
    // email against its own employees table to decide whose "My Leads" list
    // this shows up in.
    let creatorEmail = null;
    if (requestingUserId) {
      const userRes = await pool.query(`SELECT email FROM users WHERE id = $1`, [requestingUserId]);
      creatorEmail = userRes.rows[0]?.email || null;
    }

    const outstanding = Number(invoice.balance_amount || 0);
    const paymentStatus = outstanding <= 0 ? 'Paid' : (Number(invoice.paid_amount || 0) > 0 ? 'Partial' : 'Pending');

    const payload = {
      student_name: invoice.customer_name,
      phone: cust.phone || '',
      email: invoice.customer_email,
      service_type: cust.service_type || invoice.service_type || '',
      invoice_number: invoice.invoice_number,
      total_amount: invoice.total_amount,
      paid_amount: invoice.paid_amount,
      outstanding_amount: outstanding,
      payment_status: paymentStatus,
      agreement_pdf_url: `${process.env.INVOICE_APP_PUBLIC_URL || 'https://invoice.vjcoverseas.com'}/api/invoices/agreement-pdf-by-token/${invoice.chairman_token}`,
      created_by_email: creatorEmail,
    };

    await axios.post(
      `${process.env.OPS_PORTAL_API_URL}/api/leads/from-invoice`,
      payload,
      { headers: { 'x-internal-key': process.env.OPS_INTERNAL_API_KEY } }
    );

    await pool.query(
      `UPDATE invoices SET sent_to_ops = true, sent_to_ops_at = NOW() WHERE id = $1`,
      [invoiceId]
    );

    return { ok: true };
  },
};

module.exports = invoiceService;