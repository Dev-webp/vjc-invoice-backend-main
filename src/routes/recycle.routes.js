// NEW FILE — mounted at /api/recycle (one line added in routes/index.js)
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth.middleware');
const recycleController = require('../controllers/recycle.controller');

router.get('/run', recycleController.run);                                   // cron (secret protected, no login)
router.get('/queue', verifyToken, recycleController.queue);
router.put('/:id/hold', verifyToken, recycleController.setHold);
router.post('/:id/recycle', verifyToken, recycleController.recycleNow);

module.exports = router;