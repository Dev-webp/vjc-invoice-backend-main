const express = require('express');
const router = express.Router();
const leadController = require('../controllers/lead.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/facebook/webhook',  leadController.verifyWebhook);
router.post('/facebook/webhook', leadController.receiveWebhookLead);

router.get('/',              verifyToken, leadController.getAll);
router.get('/:id',           verifyToken, leadController.getById);
router.post('/',             verifyToken, leadController.create);
router.post('/assign',       verifyToken, leadController.assign);
router.put('/:id/status',    verifyToken, leadController.updateStatus);
router.get('/:id/notes',            verifyToken, leadController.getNotes);
router.post('/:id/notes',           verifyToken, leadController.addNote);
router.get('/:id/profile-history',  verifyToken, leadController.getProfileHistory);
router.get('/reminders/due',            verifyToken, leadController.getDueReminders);
router.put('/reminders/:noteId/dismiss', verifyToken, leadController.dismissReminder);
router.get('/assignments/new',                  verifyToken, leadController.getNewAssignments);
router.put('/assignments/:historyId/notified',  verifyToken, leadController.markAssignmentNotified);
module.exports = router;