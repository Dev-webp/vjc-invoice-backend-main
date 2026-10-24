const teamMonitorModel = require('../models/teamMonitor.model');

// GET /api/leads/team-monitor?range=today|yesterday|7d
// chairman / mis-executive -> sees everything
// any other logged-in employee -> sees only their own leads, flags and workload
const getTeamMonitor = async (req, res) => {
  try {
    const { role } = req.user;
    const isAdmin = role === 'chairman' || role === 'mis-executive';
    const userId = req.user.id || req.user.userId || req.user._id;

    if (!isAdmin && !userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const data = await teamMonitorModel.getTeamMonitor(req.query.range, isAdmin ? null : userId);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Team monitor error:', err);
    res.status(500).json({ success: false, message: 'Failed to load team monitor' });
  }
};

module.exports = { getTeamMonitor };