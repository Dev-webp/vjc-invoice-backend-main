const reportRepo = require('../repositories/report.repository');

const wrap = (fn) => async (req, res) => {
  try {
    const role      = req.user?.role;
    const userId    = req.user?.id;
    const dateRange = req.query.dateRange || "thisMonth";
    const year      = req.query.year  || null;
    const month     = req.query.month || null;
    const day       = req.query.day   || null;
    const data = await fn({ role, userId, dateRange, year, month, day });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  salesByCustomer:        wrap(reportRepo.salesByCustomer),
  salesByItem:            wrap(reportRepo.salesByItem),
  invoiceDetails:         wrap(reportRepo.invoiceDetails),
  quoteDetails:           wrap(reportRepo.quoteDetails),
  paymentsReceived:       wrap(reportRepo.paymentsReceived),
  arAgingSummary:         wrap(reportRepo.arAgingSummary),
  customerBalanceSummary: wrap(reportRepo.customerBalanceSummary),
  salesBySalesPerson:     wrap(reportRepo.salesBySalesPerson),
  leadSourceReport:       wrap(reportRepo.leadSourceReport),        // NEW
  agentPerformanceReport: wrap(reportRepo.agentPerformanceReport),  // NEW
};