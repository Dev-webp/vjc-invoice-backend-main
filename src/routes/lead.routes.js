const express = require('express');
const router = express.Router();
const leadController = require('../controllers/lead.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
let teamMonitorController = null; // NEW
try { teamMonitorController = require('../controllers/teamMonitor.controller'); } catch (e) { console.error('Team monitor disabled:', e.message); } // NEW
router.get('/facebook/webhook',  leadController.verifyWebhook);
router.post('/facebook/webhook', leadController.receiveWebhookLead);

router.get('/',              verifyToken, leadController.getAll);
if (teamMonitorController) {
  router.get('/team-monitor', verifyToken, teamMonitorController.getTeamMonitor);
  router.get('/team-monitor/:agentId/red-flags', verifyToken, teamMonitorController.getAgentRedFlags);
}

router.get('/:id', verifyToken, leadController.getById);
router.post('/',             verifyToken, leadController.create);
router.post('/assign',       verifyToken, leadController.assign);
router.put('/:id/status',    verifyToken, leadController.updateStatus);
router.get('/:id/notes',            verifyToken, leadController.getNotes);
router.post('/:id/notes',           verifyToken, leadController.addNote);
router.get('/:id/profile-history',  verifyToken, leadController.getProfileHistory);
router.get('/reminders/due',            verifyToken, leadController.getDueReminders);
router.put('/reminders/:noteId/dismiss', verifyToken, leadController.dismissReminder);
router.get('/assignments/today',        verifyToken, leadController.getAllAssignmentsToday);
router.get('/pending-assignment',       verifyToken, leadController.getPendingAssignments);
router.put('/:id/classify',             verifyToken, leadController.classifyPendingLead);
router.get('/assignments/new',                  verifyToken, leadController.getNewAssignments);
router.put('/assignments/:historyId/notified',  verifyToken, leadController.markAssignmentNotified);
router.get('/assignments/today',                verifyToken, leadController.getAllAssignmentsToday);
module.exports = router;