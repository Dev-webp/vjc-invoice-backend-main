const model = require('../models/followup.model');

const who = (req) => {
  const role = req.user.role;
  return {
    id: req.user.id || req.user.userId || req.user._id,
    isAdmin: role === 'chairman' || role === 'mis-executive',
  };
};

const canSeeLead = (lead, u) =>
  u.isAdmin || String(lead.assigned_to) === String(u.id) || String(lead.created_by) === String(u.id);

const fail = (res, err, label) => {
  if (err.status) return res.status(err.status).json({ success: false, message: err.message });
  console.error(label, err);
  return res.status(500).json({ success: false, message: 'Something went wrong' });
};

// GET /api/leads/:id/followups
const getFollowups = async (req, res) => {
  try {
    const u = who(req);
    const lead = await model.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canSeeLead(lead, u)) return res.status(403).json({ success: false, message: 'Not authorized' });
    const followups = await model.listFollowups(req.params.id);
    res.json({ success: true, lead, followups, appointments: [] });
  } catch (err) { fail(res, err, 'Get followups error:'); }
};

// POST /api/leads/:id/followups  { followup_date: 'YYYY-MM-DD', followup_time: 'HH:MM', remarks }
const addFollowup = async (req, res) => {
  try {
    const u = who(req);
    const lead = await model.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canSeeLead(lead, u)) return res.status(403).json({ success: false, message: 'Not authorized' });
    const row = await model.addFollowup(req.params.id, req.body || {}, u.id);
    res.json({ success: true, id: row.id });
  } catch (err) { fail(res, err, 'Add followup error:'); }
};

// PUT /api/leads/followups/:noteId/done
const markDone = async (req, res) => {
  try {
    const u = who(req);
    const row = await model.markDone(req.params.noteId, u.id, u.isAdmin, (req.body || {}).remark);    if (!row) return res.status(403).json({ success: false, message: 'Not authorized or not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err, 'Mark followup done error:'); }
};

// GET /api/leads/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// chairman / mis-executive -> everyone's followups, employee -> only their own
const getCalendar = async (req, res) => {
  try {
    const u = who(req);
    const events = await model.calendarEvents(req.query.from, req.query.to, u.isAdmin ? null : u.id);
    res.json({ success: true, events });
  } catch (err) { fail(res, err, 'Calendar error:'); }
};

module.exports = { getFollowups, addFollowup, markDone, getCalendar };