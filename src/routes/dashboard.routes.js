const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/dashboard.controller');
const { verifyToken } = require('./auth');

router.get('/kpis',                verifyToken, ctrl.getKpis);
router.get('/sales-overview',      verifyToken, ctrl.getSalesExpensesOverview);
router.get('/recent-invoices',     verifyToken, ctrl.getRecentInvoices);

module.exports = router;