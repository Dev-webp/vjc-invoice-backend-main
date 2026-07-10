const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salesInvoice.controller');

router.get('/',              ctrl.getSalesInvoices);
router.get('/:id',           ctrl.getSalesInvoiceById);
router.post('/',             ctrl.createSalesInvoice);
router.put('/:id',           ctrl.updateSalesInvoice);
router.patch('/:id/status',  ctrl.updateSalesInvoiceStatus);
router.delete('/:id',        ctrl.deleteSalesInvoice);

module.exports = router;