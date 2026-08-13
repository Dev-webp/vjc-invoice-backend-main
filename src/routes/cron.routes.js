const express = require('express');
const router = express.Router();
const cronController = require('../controllers/cron.controller');

// No verifyToken here on purpose — the external cron service calling this
// URL isn't a logged-in user. It's instead protected by the ?secret=...
// check inside cron.controller.js (CRON_SECRET env variable).
router.get('/sla-check', cronController.slaCheck);

module.exports = router;