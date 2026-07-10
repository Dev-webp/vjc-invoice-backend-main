const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/timetracking.controller');

router.get('/', ctrl.getAll);
router.post('/logs', ctrl.createLog);
router.put('/logs/:id', ctrl.updateLog);
router.delete('/logs/:id', ctrl.deleteLog);
router.post('/logs/:id/convert', ctrl.convertToInvoice);
router.post('/projects', ctrl.createProject);

module.exports = router;