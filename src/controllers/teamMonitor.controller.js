const teamMonitorModel = require('../models/teamMonitor.model');
let departmentModel = null;   // NEW — safe load, Team Monitor never breaks because of this
try { departmentModel = require('../models/department.model'); } catch (e) { console.error('Meeting summary disabled:', e.message); }

// NEW — live totals from ALL leads. range: all | today | yesterday | 7d, or dateStr 'YYYY-MM-DD'.
const pool = require('../config/db');
const getOverall = async (range, dateStr, userIdOrNull) => {
  const params = [];
  let dateClause = '';
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    params.push(dateStr);
    dateClause = `AND l.created_at::date = $${params.length}::date`;
  } else if (range === 'today') {
    dateClause = `AND l.created_at::date = CURRENT_DATE`;
  } else if (range === 'yesterday') {
    dateClause = `AND l.created_at::date = CURRENT_DATE - 1`;
  } else if (range === '7d') {
    dateClause = `AND l.created_at::date BETWEEN CURRENT_DATE - 6 AND CURRENT_DATE`;
  }
  let scopeClause = '';
  if (userIdOrNull) {
    params.push(String(userIdOrNull));
    scopeClause = `AND l.assigned_to::text = $${params.length}::text`;
  }
  const where = `WHERE 1=1 ${dateClause} ${scopeClause}`;

  const totals = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE l.assigned_to IS NOT NULL)::int AS assigned,
            COUNT(*) FILTER (WHERE l.assigned_to IS NOT NULL AND COALESCE(l.status,'New') <> 'New')::int AS contacted,
            COUNT(*) FILTER (WHERE l.status IN ('Warm','Prospect'))::int AS warm_prospect,
            COUNT(*) FILTER (WHERE l.status = 'Pending Agreement')::int AS pending_agreement,
            COUNT(*) FILTER (WHERE l.status = 'Closed')::int AS closed,
            COUNT(*) FILTER (WHERE l.status = 'Dead')::int AS dead
     FROM leads l ${where}`,
    params
  );

  const bySource = await pool.query(
    `SELECT COALESCE(NULLIF(l.source,''), 'Unknown') AS source, COUNT(*)::int AS count
     FROM leads l ${where}
     GROUP BY 1 ORDER BY count DESC`,
    params
  );

  const byDept = await pool.query(
    `SELECT COALESCE(d.name, NULLIF(l.service_type,''), 'Unassigned') AS department,
            COUNT(*)::int AS new_leads
     FROM leads l
     LEFT JOIN departments d ON d.id = l.department_id
     ${where}
     GROUP BY 1 ORDER BY new_leads DESC`,
    params
  );

  const byAgent = await pool.query(
    `SELECT l.assigned_to AS id,
            COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE COALESCE(l.status,'New') <> 'New')::int AS contacted,
            COUNT(*) FILTER (WHERE l.status = 'Warm')::int AS warm,
            COUNT(*) FILTER (WHERE l.status = 'Prospect')::int AS prospect
     FROM leads l
     ${where} AND l.assigned_to IS NOT NULL
     GROUP BY l.assigned_to`,
    params
  );

  return {
    ...totals.rows[0],
    by_source: bySource.rows,
    by_department: byDept.rows,
    by_agent: byAgent.rows,
  };
};// GET /api/leads/team-monitor?range=today|yesterday|7d
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

        // NEW — "all" is handled by the overall block below; the old blocks keep working on today
    const modelRange = req.query.range === 'all' ? 'today' : req.query.range;
    const data = await teamMonitorModel.getTeamMonitor(
      modelRange,
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

    // NEW — live totals from all leads; if this fails the rest of Team Monitor still loads
    let overall = null;
    try {
      overall = await getOverall(req.query.range, req.query.date, isAdmin ? null : userId);
    } catch (e) {
      console.error('Overall totals error:', e.message);
    }

    res.json({ success: true, ...data, meetings, overall });  } catch (err) {
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