const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');

const { verifyToken, chairmanOnly } = require('../middlewares/auth.middleware');  // CHANGED: added chairmanOnly

router.get('/pending', verifyToken, chairmanOnly, invoiceController.getPending);       // NEW
router.get('/rejected', verifyToken, invoiceController.getRejected);                   // NEW
router.put('/:id/approve', verifyToken, chairmanOnly, invoiceController.approveById);  // NEW
router.put('/:id/reject',  verifyToken, chairmanOnly, invoiceController.rejectById);   // NEW

router.get('/',    verifyToken, invoiceController.getAll);           // ← ADD
router.get('/:id/download-pdf', verifyToken, invoiceController.downloadPdf);
router.post('/',   verifyToken, invoiceController.create);           // ← ADD
router.get('/approve/:token', invoiceController.approve);            // no auth — email link
router.get('/reject/:token',  invoiceController.reject);             // no auth — email link
router.get('/preview-pdf/:token', invoiceController.previewPdf);     // NEW — no auth, email link, view before approve

module.exports = router;