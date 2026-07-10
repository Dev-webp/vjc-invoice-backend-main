const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/quote.controller');

const { verifyToken } = require('../middlewares/auth.middleware');  // ← ADD

router.get('/',             verifyToken, ctrl.getQuotes);           // ← ADD
router.get('/:id',          verifyToken, ctrl.getQuoteById);
router.post('/',            verifyToken, ctrl.createQuote);
router.put('/:id',          verifyToken, ctrl.updateQuote);
router.patch('/:id/status', verifyToken, ctrl.updateQuoteStatus);
router.delete('/:id',       verifyToken, ctrl.deleteQuote);
module.exports = router;