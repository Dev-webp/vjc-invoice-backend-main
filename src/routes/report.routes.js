const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/report.controller');

const { verifyToken } = require('../middlewares/auth.middleware');  // ← ADD

router.get('/sales-by-customer',        verifyToken, ctrl.salesByCustomer);
router.get('/sales-by-item',            verifyToken, ctrl.salesByItem);
router.get('/invoice-details',          verifyToken, ctrl.invoiceDetails);
router.get('/quote-details',            verifyToken, ctrl.quoteDetails);
router.get('/payments-received',        verifyToken, ctrl.paymentsReceived);
router.get('/ar-aging-summary',         verifyToken, ctrl.arAgingSummary);
router.get('/customer-balance-summary', verifyToken, ctrl.customerBalanceSummary);
router.get('/sales-by-salesperson',     verifyToken, ctrl.salesBySalesPerson);
router.get('/lead-source',              verifyToken, ctrl.leadSourceReport);        // NEW
router.get('/agent-performance',        verifyToken, ctrl.agentPerformanceReport);  // NEW
module.exports = router;