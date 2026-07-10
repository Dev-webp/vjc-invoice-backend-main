const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');
const { verifyToken } = require('../middlewares/auth.middleware');  // ← ADD

router.get('/',     verifyToken, customerController.getAll);    // ← ADD verifyToken
router.get('/:id',  verifyToken, customerController.getById);
router.post('/',    verifyToken, customerController.create);
router.put('/:id',  verifyToken, customerController.update);
router.delete('/:id', verifyToken, customerController.delete);

module.exports = router;