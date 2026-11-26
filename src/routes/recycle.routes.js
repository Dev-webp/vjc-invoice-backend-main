// NEW FILE (v2) — mounted at /api/recycle (the 2 lines in routes/index.js are already there)
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth.middleware');
const recycleController = require('../controllers/recycle.controller');

router.get('/run', recycleController.run);                                    // cron (secret protected, no login)
router.get('/queue', verifyToken, recycleController.queue);
router.get('/suppressed', verifyToken, recycleController.suppressed);
router.get('/lead/:id/lifecycle', verifyToken, recycleController.lifecycle);
router.put('/:id/hold', verifyToken, recycleController.setHold);
router.put('/:id/suppress', verifyToken, recycleController.suppress);
router.put('/:id/release', verifyToken, recycleController.release);
router.post('/:id/recycle', verifyToken, recycleController.recycleNow);

module.exports = router;