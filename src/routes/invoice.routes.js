const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');

const { verifyToken } = require('../middlewares/auth.middleware');  // ← ADD

router.get('/',    verifyToken, invoiceController.getAll);           // ← ADD
router.get('/:id/download-pdf', verifyToken, invoiceController.downloadPdf);
router.post('/',   verifyToken, invoiceController.create);           // ← ADD
router.get('/approve/:token', invoiceController.approve);            // no auth — email link
router.get('/reject/:token',  invoiceController.reject);             // no auth — email link

module.exports = router;