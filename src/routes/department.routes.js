
const express = require('express');
const router = express.Router();

const departmentController = require('../controllers/department.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/', verifyToken, departmentController.getAll);

// Client Meeting Mode
router.get('/meeting-mode', verifyToken, departmentController.getMyMeetingMode);
router.put('/meeting-mode', verifyToken, departmentController.setMyMeetingMode);

// Department Staff
router.post('/:id/staff', verifyToken, departmentController.addStaff);
router.delete('/:id/staff/:staffId', verifyToken, departmentController.removeStaff);

// Staff Online / Offline
router.post('/staff/online', departmentController.setOnline);
router.post('/staff/offline', departmentController.setOffline);

// External Cron
router.get('/daily-reset', departmentController.dailyReset);

module.exports = router;
