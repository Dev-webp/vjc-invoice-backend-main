const service = require('../services/timetracking.service');

const timeTrackingController = {

  // GET /api/timetracking → logs + projects + stats
  getAll: async (req, res) => {
    try {
      const data = await service.getAllData();
      res.json({ success: true, ...data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // POST /api/timetracking/logs
  createLog: async (req, res) => {
    try {
      const log = await service.createLog(req.body);
      res.status(201).json({ success: true, log });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },

  // PUT /api/timetracking/logs/:id
  updateLog: async (req, res) => {
    try {
      const log = await service.updateLog(req.params.id, req.body);
      res.json({ success: true, log });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },

  // DELETE /api/timetracking/logs/:id
  deleteLog: async (req, res) => {
    try {
      await service.deleteLog(req.params.id);
      res.json({ success: true, message: 'Time log deleted' });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },

  // POST /api/timetracking/logs/:id/convert
  convertToInvoice: async (req, res) => {
    try {
      const invoice = await service.convertToInvoice(req.params.id);
      res.json({ success: true, invoice, message: 'Invoice created! Chairman approval email sent.' });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },

  // POST /api/timetracking/projects
  createProject: async (req, res) => {
    try {
      const project = await service.createProject(req.body);
      res.status(201).json({ success: true, project });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
};

module.exports = timeTrackingController;