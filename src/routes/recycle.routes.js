// NEW FILE (v3) — mounted at /api/recycle (the 2 lines in routes/index.js are already there)
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth.middleware');
const c = require('../controllers/recycle.controller');

router.get('/run', c.run);                                    // cron (secret protected, no login)
router.get('/queue', verifyToken, c.queue);
router.get('/suppressed', verifyToken, c.suppressed);
router.get('/rules', verifyToken, c.getRules);
router.put('/rules', verifyToken, c.saveRule);
router.post('/rules/reset', verifyToken, c.resetRule);
router.get('/lead/:id/lifecycle', verifyToken, c.lifecycle);
router.put('/:id/hold', verifyToken, c.setHold);
router.put('/:id/dead-reason', verifyToken, c.deadReason);
router.put('/:id/department', verifyToken, c.setDepartment);
router.put('/:id/suppress', verifyToken, c.suppress);
router.put('/:id/release', verifyToken, c.release);
router.post('/:id/recycle', verifyToken, c.recycleNow);

module.exports = router;