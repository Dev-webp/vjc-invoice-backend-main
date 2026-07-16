const express = require('express');
const router = express.Router();
const leadController = require('../controllers/lead.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/',              verifyToken, leadController.getAll);
router.get('/:id',           verifyToken, leadController.getById);
router.post('/',             verifyToken, leadController.create);
router.post('/assign',       verifyToken, leadController.assign);
router.put('/:id/status',    verifyToken, leadController.updateStatus);
router.get('/:id/notes',            verifyToken, leadController.getNotes);
router.post('/:id/notes',           verifyToken, leadController.addNote);
router.get('/:id/profile-history',  verifyToken, leadController.getProfileHistory);

module.exports = router;
