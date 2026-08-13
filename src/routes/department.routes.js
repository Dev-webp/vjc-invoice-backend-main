const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/department.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/', verifyToken, departmentController.getAll);
router.post('/:id/staff', verifyToken, departmentController.addStaff);
router.delete('/:id/staff/:staffId', verifyToken, departmentController.removeStaff);

module.exports = router;