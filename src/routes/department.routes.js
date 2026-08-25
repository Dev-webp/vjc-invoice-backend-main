const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/department.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/', verifyToken, departmentController.getAll);
router.post('/:id/staff', verifyToken, departmentController.addStaff);
router.delete('/:id/staff/:staffId', verifyToken, departmentController.removeStaff);
router.post('/staff/online', departmentController.setOnline);
router.post('/staff/offline', departmentController.setOffline);
router.get('/daily-reset', departmentController.dailyReset);   // NEW — external cron only, no auth (secret-protected like sla-check)

module.exports = router;