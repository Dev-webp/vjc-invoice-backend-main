const express = require('express');
const router = express.Router();
const itemController = require('../controllers/item.controller');
const { verifyToken, servicesAccess } = require('../middlewares/auth.middleware');  // ← ADD

router.get('/',     verifyToken, itemController.getAll);
router.get('/:id',  verifyToken, itemController.getById);
router.post('/',    verifyToken, servicesAccess, itemController.create);
router.put('/:id',  verifyToken, servicesAccess, itemController.update);
router.delete('/:id', verifyToken, servicesAccess, itemController.delete);

module.exports = router;