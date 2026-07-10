const quoteRepo = require('../repositories/quote.repository');
const customerRepository = require('../repositories/customer.repository');
const emailService = require('../services/email.service');
const { generateQuoteId } = require('../models/quote');

// ── Helper: send mail to customer if quote status is "Sent" ──
const sendQuoteMailIfNeeded = async (quote) => {
  try {
    if (!quote || quote.status !== 'Sent') return;

    // quote.customer_id is the CUS00X string — look that up first
    let customer = await customerRepository.getByCustomerId(quote.customer_id);
    if (!customer) {
      customer = await customerRepository.getById(quote.customer_id);
    }

    if (!customer || !customer.email) {
      console.warn(
        '⚠️ Quote mail skipped — no customer/email found for customer_id:',
        quote.customer_id
      );
      return;
    }

    await emailService.sendQuoteToCustomerMail({
      ...quote,
      customer_email: customer.email,
      customer_name: quote.customer_name || customer.name,
    });
  } catch (err) {
    console.error('QUOTE MAIL ERROR:', err.message);
  }
};
// GET all quotes
const getQuotes = async (req, res) => {
  try {
    const role   = req.user?.role;
    const userId = req.user?.id;
    const { page, limit } = req.query;
    const { rows: quotes, total } = await quoteRepo.getAllQuotes({ role, userId, page, limit });
    const pageNum  = Number(page)  || 1;
    const limitNum = Number(limit) || 25;
    const totalPages = Math.ceil(total / limitNum);
    res.json({ success: true, data: quotes, total, page: pageNum, totalPages });
  } catch (err) {
    console.error("GET QUOTES ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET single quote
const getQuoteById = async (req, res) => {
  try {
    const quote = await quoteRepo.getQuoteById(req.params.id);

    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: 'Quote not found' });
    }

    res.json({ success: true, data: quote });
  } catch (err) {
    console.error("GET QUOTE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST create quote
const createQuote = async (req, res) => {
  try {
    console.log("========== CREATE QUOTE ==========");
    console.log("REQUEST BODY:");
    console.log(JSON.stringify(req.body, null, 2));

    const quote_id = await generateQuoteId();

    console.log("GENERATED QUOTE ID:", quote_id);

   const quote = await quoteRepo.createQuote({
  ...req.body,
  quote_id,
  created_by: req.user?.id,        // ← ADD
});

console.log("QUOTE SAVED SUCCESSFULLY");
console.log(quote);

// 🔔 send mail to customer if quote was saved as "Sent"
// (line_items aren't persisted on the quotes table, so pass the
//  original request items along for the email breakdown)
await sendQuoteMailIfNeeded({
  ...quote,
  line_items: req.body.line_items || [],
});

    res.status(201).json({
      success: true,
      data: quote
    });
  } catch (err) {
    console.error("========== CREATE QUOTE ERROR ==========");
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// PUT update quote
const updateQuote = async (req, res) => {
  try {
    const bodyKeys = Object.keys(req.body);

    if (bodyKeys.length === 1 && bodyKeys[0] === 'status') {
      const quote = await quoteRepo.updateQuoteStatus(
        req.params.id,
        req.body.status
      );

      if (!quote) {
        return res
          .status(404)
          .json({ success: false, message: 'Quote not found' });
      }

      // 🔔 send mail to customer if status was changed to "Sent"
      await sendQuoteMailIfNeeded(quote);

      return res.json({
        success: true,
        data: quote
      });
    }

    const quote = await quoteRepo.updateQuote(
      req.params.id,
      req.body
    );

    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: 'Quote not found' });
    }

    // 🔔 send mail to customer if quote was updated to "Sent"
    await sendQuoteMailIfNeeded(quote);

    res.json({
      success: true,
      data: quote
    });
  } catch (err) {
    console.error("UPDATE QUOTE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH status only
const updateQuoteStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const quote = await quoteRepo.updateQuoteStatus(
      req.params.id,
      status
    );

    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: 'Quote not found' });
    }

    // 🔔 send mail to customer if status was changed to "Sent"
    await sendQuoteMailIfNeeded(quote);

    res.json({
      success: true,
      data: quote
    });
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE quote
const deleteQuote = async (req, res) => {
  try {
    await quoteRepo.deleteQuote(req.params.id);

    res.json({
      success: true,
      message: 'Quote deleted'
    });
  } catch (err) {
    console.error("DELETE QUOTE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
};