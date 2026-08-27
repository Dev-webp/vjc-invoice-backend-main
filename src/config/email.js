const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((err, success) => {
  if (err) {
    console.error('❌ Email error:', err.message);
  } else {
    console.log('✅ Email Ready! (Chairman approval — vjcmani)');
  }
});

// NEW — 4 additional transporters, one per mail purpose.
// Attached as properties on the SAME `transporter` object so every
// existing `require('../config/email')` call elsewhere keeps working
// exactly as before (transporter.sendMail(...) is untouched).

transporter.invoice = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER_INVOICE,
    pass: process.env.EMAIL_PASS_INVOICE,
  },
});
transporter.invoice.verify((err) => {
  if (err) console.error('❌ Email error (invoice):', err.message);
  else console.log('✅ Email Ready! (Invoice — vjcinvoice)');
});

transporter.proforma = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER_PROFORMA,
    pass: process.env.EMAIL_PASS_PROFORMA,
  },
});
transporter.proforma.verify((err) => {
  if (err) console.error('❌ Email error (proforma):', err.message);
  else console.log('✅ Email Ready! (Proforma — vjcproformainvoice)');
});

transporter.payment = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER_PAYMENT,
    pass: process.env.EMAIL_PASS_PAYMENT,
  },
});
transporter.payment.verify((err) => {
  if (err) console.error('❌ Email error (payment):', err.message);
  else console.log('✅ Email Ready! (Payment — vjcpaymentreceived)');
});

transporter.agreement = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER_AGREEMENT,
    pass: process.env.EMAIL_PASS_AGREEMENT,
  },
});
transporter.agreement.verify((err) => {
  if (err) console.error('❌ Email error (agreement):', err.message);
  else console.log('✅ Email Ready! (Agreement — vjcagreements)');
});

module.exports = transporter;