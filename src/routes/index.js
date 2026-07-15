const express = require('express');
const router  = express.Router();

const customerRoutes         = require('./customer.routes');
const invoiceRoutes          = require('./invoice.routes');
const itemRoutes             = require('./item.routes');
const quoteRoutes            = require('./quote.routes');
const salesInvoiceRoutes     = require('./salesInvoice.routes');
const paymentRoutes          = require('./payment.routes');
const recurringInvoiceRoutes = require('./recurringInvoice.routes');
const expenseRoutes          = require('./expense.routes');
const timeTrackingRoutes = require('./timetracking.routes');
const reportRoutes = require('./report.routes'); 
const dashboardRoutes = require('./dashboard.routes');
const leadRoutes = require('./lead.routes'); 

router.use('/customers',          customerRoutes);
router.use('/invoices',           invoiceRoutes);
router.use('/items',              itemRoutes);
router.use('/quotes',             quoteRoutes);
router.use('/sales-invoices',     salesInvoiceRoutes);
router.use('/payments',           paymentRoutes);
router.use('/recurring-invoices', recurringInvoiceRoutes); 
router.use('/expenses',           expenseRoutes);
router.use('/timetracking', timeTrackingRoutes);
router.use('/reports', reportRoutes);
router.use('/dashboard', dashboardRoutes);   
router.use('/leads', leadRoutes);    

module.exports = router;