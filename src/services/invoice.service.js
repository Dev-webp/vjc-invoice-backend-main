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
        // NEW — link the client can open to review + digitally sign the agreement
        sign_link: `${process.env.INVOICE_APP_PUBLIC_URL || 'https://invoice.vjcoverseas.com'}/api/invoices/agreement-sign/${approved.chairman_token}`,
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
              outstanding, last_transaction,
              agreement_signed, agreement_signature, agreement_signed_name, agreement_signed_at
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
      // NEW — includes the client's e-signature (if signed) in the downloaded PDF
      signature: cust.agreement_signature || cust.agreement_signed_name || null,
      signed_at: cust.agreement_signed_at || null,
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
              outstanding, last_transaction,
              agreement_signed, agreement_signature, agreement_signed_name, agreement_signed_at
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
      // NEW — includes the client's e-signature (if signed) in the downloaded PDF
      signature: cust.agreement_signature || cust.agreement_signed_name || null,
      signed_at: cust.agreement_signed_at || null,
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
      `SELECT phone, service_type, agreement_generated, agreement_signed FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.agreement_generated) {
      throw new Error('Agreement not yet generated for this customer — cannot send to Ops yet');
    }
    // NEW — client must have digitally signed the agreement before this can be sent to Ops
    if (!cust.agreement_signed) {
      throw new Error('Agreement not signed by the client yet — cannot send to Ops');
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

  // ════════════════════════════════════════════════════════════════
  // NEW — Agreement e-signature feature (added below, nothing above
  // this line in this file was changed except 5 small marked edits:
  // getAgreementPdfBuffer, getAgreementPdfBufferByToken, sendToOps,
  // and _generateAgreementIfNeeded — each tagged with "NEW —" comments).
  // ════════════════════════════════════════════════════════════════

  // NEW — builds the public, no-login agreement signing page (raw HTML
  // string, same pattern as approve()/reject() above). Reuses
  // agreementService.buildAgreementHtml so the EXACT same agreement text
  // used in the PDF is shown here — nothing added, nothing left out.
  // If the customer already signed, returns a locked "already signed"
  // page instead of the signing form (no edit / no re-sign possible).
  getAgreementSignPageHtml: async (token) => {
    const agreementService = require('./agreement.service');

    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid or expired link');

    const custRes = await pool.query(
      `SELECT name, email, phone, address, city, state, service_type,
              agreement_generated, agreement_total_amount, agreement_number,
              outstanding, last_transaction,
              agreement_signed, agreement_signature, agreement_signed_name, agreement_signed_at
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
      signature: cust.agreement_signature || cust.agreement_signed_name || null,
      signed_at: cust.agreement_signed_at || null,
    };

    const agreementBodyHtml = agreementService.buildAgreementHtml(agreementData);

    if (cust.agreement_signed) {
      // ── Locked view — already signed. No form, no edit, no re-sign. ──
      return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Agreement Signed</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px;">
<div style="max-width:800px;margin:0 auto;">
<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:16px 20px;margin-bottom:16px;text-align:center;">
<h2 style="color:#2e7d32;margin:6px 0;">Agreement already signed</h2>
<p style="color:#444;margin:4px 0;">Signed by <strong>${cust.agreement_signed_name || cust.name}</strong> on ${new Date(cust.agreement_signed_at).toLocaleString('en-GB')}</p>
<p style="color:#777;font-size:13px;">This agreement is locked and cannot be edited or signed again.</p>
<a href="${process.env.INVOICE_APP_PUBLIC_URL || 'https://invoice.vjcoverseas.com'}/api/invoices/agreement-pdf-by-token/${token}"
style="display:inline-block;margin-top:10px;background:#0f9d94;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;">Download signed agreement PDF</a>
</div>
<div style="background:#fff;border:1px solid #ddd;border-radius:8px;">${agreementBodyHtml}</div>
</div>
</body></html>`;
    }

    // ── Not signed yet — full agreement + checkbox + signature pad ──
    return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Sign Service Agreement</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px;">
<div style="max-width:800px;margin:0 auto;">
<h2 style="text-align:center;color:#0f9d94;">Please review and sign your Service Agreement</h2>
<div style="background:#fff;border:1px solid #ddd;border-radius:8px;max-height:480px;overflow-y:auto;padding:0 10px;">${agreementBodyHtml}</div>
<div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:20px;margin-top:16px;">
<label style="display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#333;">
<input type="checkbox" id="agreeCheck" style="margin-top:3px;" />
<span>I have read and agree to the terms of this Service Agreement.</span>
</label>
<div style="margin-top:18px;">
<label style="font-size:14px;font-weight:bold;color:#333;">Full legal name (required)</label><br/>
<input type="text" id="signedName" placeholder="Type your full name" style="width:100%;box-sizing:border-box;padding:10px;margin-top:6px;border:1px solid #ccc;border-radius:6px;font-size:14px;" />
</div>
<div style="margin-top:18px;">
<label style="font-size:14px;font-weight:bold;color:#333;">Draw your signature (optional)</label>
<div style="border:1px dashed #999;border-radius:6px;margin-top:6px;">
<canvas id="sigPad" style="width:100%;height:150px;touch-action:none;"></canvas>
</div>
<button type="button" id="clearSig" style="margin-top:8px;background:#eee;border:1px solid #ccc;border-radius:6px;padding:6px 14px;cursor:pointer;">Clear</button>
</div>
<p id="errMsg" style="color:#d32f2f;font-size:13px;display:none;margin-top:14px;"></p>
<button type="button" id="submitBtn" style="width:100%;margin-top:18px;background:#0f9d94;color:#fff;border:none;padding:14px;border-radius:6px;font-size:16px;cursor:pointer;">Confirm &amp; Sign Agreement</button>
</div>
</div>
<script>
var canvas = document.getElementById('sigPad');
canvas.width = canvas.offsetWidth;
canvas.height = 150;
var ctx = canvas.getContext('2d');
ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#222';
var drawing = false, hasDrawn = false;
function pos(e){ var r = canvas.getBoundingClientRect(); var t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
function start(e){ drawing = true; hasDrawn = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
function move(e){ if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
function end(){ drawing = false; }
canvas.addEventListener('mousedown', start);
canvas.addEventListener('mousemove', move);
window.addEventListener('mouseup', end);
canvas.addEventListener('touchstart', start);
canvas.addEventListener('touchmove', move);
canvas.addEventListener('touchend', end);
document.getElementById('clearSig').addEventListener('click', function(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasDrawn = false; });
document.getElementById('submitBtn').addEventListener('click', function(){
  var btn = this;
  var errEl = document.getElementById('errMsg');
  errEl.style.display = 'none';
  var agree = document.getElementById('agreeCheck').checked;
  var name = document.getElementById('signedName').value.trim();
  if (!agree) { errEl.textContent = 'Please tick the checkbox to confirm you agree.'; errEl.style.display = 'block'; return; }
  if (!name) { errEl.textContent = 'Please type your full legal name.'; errEl.style.display = 'block'; return; }
  var signature = hasDrawn ? canvas.toDataURL('image/png') : null;
  btn.disabled = true; btn.textContent = 'Submitting...';
  fetch(window.location.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature: signature, signedName: name })
  }).then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
  .then(function(r){
    if (!r.ok || !r.data.success) {
      errEl.textContent = (r.data && r.data.message) || 'Something went wrong. Please try again.';
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Confirm & Sign Agreement';
      return;
    }
    window.location.reload();
  }).catch(function(){
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Confirm & Sign Agreement';
  });
});
</script>
</body></html>`;
  },

  // NEW — saves the client's e-signature. Throws (and saves nothing) if
  // already signed, so an agreement can only ever be signed exactly once —
  // no edit, no overwrite, no re-sign.
  signAgreementByToken: async (token, { signature, signedName }) => {
    if (!signedName || !signedName.trim()) {
      throw new Error('Full name is required to sign');
    }

    const invoice = await invoiceRepository.getByToken(token);
    if (!invoice) throw new Error('Invalid or expired link');

    const custRes = await pool.query(
      `SELECT id, agreement_generated, agreement_signed FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.agreement_generated) {
      throw new Error('Agreement not yet generated for this customer');
    }
    if (cust.agreement_signed) {
      throw new Error('This agreement has already been signed and cannot be signed again');
    }

    await pool.query(
      `UPDATE customers SET
        agreement_signed = true,
        agreement_signature = $1,
        agreement_signed_name = $2,
        agreement_signed_at = NOW()
       WHERE id = $3`,
      [signature || null, signedName.trim(), cust.id]
    );

    return { ok: true };
  },

  // NEW — for the dashboard "Agreement Link" dropdown item: returns the
  // shareable signing link + current signed status, so it can be copied
  // and sent to the client manually (WhatsApp / mail / anything).
  getAgreementLinkInfo: async (invoiceId) => {
    const invoice = await invoiceRepository.getById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const custRes = await pool.query(
      `SELECT agreement_generated, agreement_signed, agreement_signed_at
       FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.agreement_generated) {
      throw new Error('Agreement not yet generated for this customer');
    }

    return {
      link: `${process.env.INVOICE_APP_PUBLIC_URL || 'https://invoice.vjcoverseas.com'}/api/invoices/agreement-sign/${invoice.chairman_token}`,
      signed: !!cust.agreement_signed,
      signed_at: cust.agreement_signed_at || null,
    };
  },
};

module.exports = invoiceService;