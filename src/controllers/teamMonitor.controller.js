const teamMonitorModel = require('../models/teamMonitor.model');
let departmentModel = null;   // NEW — safe load, Team Monitor never breaks because of this
try { departmentModel = require('../models/department.model'); } catch (e) { console.error('Meeting summary disabled:', e.message); }
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

    const data = await teamMonitorModel.getTeamMonitor(
      req.query.range,
      isAdmin ? null : userId,
      req.query.date
    );

    // NEW — meeting summary; if it fails, the rest of Team Monitor still loads
    let meetings = { agents: [] };
    try {
      if (departmentModel) {
        meetings = await departmentModel.getMeetingSummary(
          req.query.range,
          req.query.date,
          isAdmin ? null : userId
        );
      }
    } catch (e) {
      console.error('Meeting summary error:', e.message);
    }

    res.json({ success: true, ...data, meetings });
  } catch (err) {
    console.error('Team monitor error:', err);
    res.status(500).json({ success: false, message: 'Failed to load team monitor' });
  }
};

// GET /api/leads/team-monitor/:agentId/red-flags
const getAgentRedFlags = async (req, res) => {
  try {
    const { role, id, userId, _id } = req.user;
    const isAdmin = role === 'chairman' || role === 'mis-executive';

    const loggedInUserId = id || userId || _id;
    const { agentId } = req.params;

    // Employees can view only their own red flags.
    if (!isAdmin && String(loggedInUserId) !== String(agentId)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const redFlags = await teamMonitorModel.getAgentRedFlags(agentId);

    return res.json({
      success: true,
      redFlags
    });
  } catch (err) {
    console.error('Agent red flags error:', err);
    return res.status(500).json({
      success: false,
      message: "Failed to load today's red flags"
    });
  }
};

module.exports = {
  getTeamMonitor,
  getAgentRedFlags
};