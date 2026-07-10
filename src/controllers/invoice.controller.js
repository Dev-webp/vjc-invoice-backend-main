const invoiceService = require('../services/invoice.service');
const cloudinary = require('../config/cloudinary');

const invoiceController = {

  getAll: async (req, res) => {
    try {
      const role   = req.user?.role;
      const userId = req.user?.id;
      const data = await invoiceService.getAllInvoices({ role, userId });
      res.json({ success: true, ...data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

 create: async (req, res) => {
    try {
      let screenshotUrl = null;
      if (req.body.screenshot_base64) {
        const uploadResult = await cloudinary.uploader.upload(req.body.screenshot_base64, {
          folder: 'vjc-invoice-screenshots',
        });
        screenshotUrl = uploadResult.secure_url;
      }

      const invoice = await invoiceService.createInvoice({
        ...req.body,
        created_by: req.user?.id,        // ← ADD
        screenshot_base64: screenshotUrl,
      });
      res.status(201).json({ success: true, invoice });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
  approve: async (req, res) => {
    try {
      const invoice = await invoiceService.approveInvoice(req.params.token);
      res.send(`
        <html>
          <body style="font-family:Arial; text-align:center; padding:50px;">
            <h1 style="color:#2e7d32;">✅ Invoice Approved!</h1>
            <p>Invoice <strong>${invoice.invoice_number}</strong> approved.</p>
            <p>Client mail sent to <strong>${invoice.customer_email}</strong></p>
            <p style="color:#666;">You can close this tab.</p>
          </body>
        </html>
      `);
    } catch (err) {
      res.status(400).send(`
        <html>
          <body style="font-family:Arial; text-align:center; padding:50px;">
            <h1 style="color:#d32f2f;">❌ Error</h1>
            <p>${err.message}</p>
          </body>
        </html>
      `);
    }
  },

  reject: async (req, res) => {
    try {
      const invoice = await invoiceService.rejectInvoice(req.params.token);
      res.send(`
        <html>
          <body style="font-family:Arial; text-align:center; padding:50px;">
            <h1 style="color:#d32f2f;">❌ Invoice Rejected</h1>
            <p>Invoice <strong>${invoice.invoice_number}</strong> rejected.</p>
            <p style="color:#666;">You can close this tab.</p>
          </body>
        </html>
      `);
    } catch (err) {
      res.status(400).send(`
        <html>
          <body style="font-family:Arial; text-align:center; padding:50px;">
            <h1 style="color:#d32f2f;">❌ Error</h1>
            <p>${err.message}</p>
          </body>
        </html>
      `);
    }
  },

  downloadPdf: async (req, res) => {
    try {
      const { pdfBuffer, invoice_number } = await invoiceService.getInvoicePdfBuffer(req.params.id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${invoice_number}.pdf"`,
        'Content-Length': pdfBuffer.length,
      });
      res.send(pdfBuffer);
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
};

module.exports = invoiceController;