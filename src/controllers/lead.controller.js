const leadModel = require('../models/lead.model');
const axios = require('axios');

// POST /api/leads  — Add Enquiry
const create = async (req, res) => {
  try {
    const { lead_name, contact_number, source } = req.body;
    if (!lead_name || !contact_number || !source) {
      return res.status(400).json({
        success: false,
        message: 'Lead Name, Contact Number and Source are required',
      });
    }

    const createdBy = req.user.id || req.user.userId || req.user._id;
    const lead = await leadModel.createLead(
      { ...req.body, branch: req.body.branch || req.user.location },
      createdBy
    );

    let finalLead = lead;
    try {
      if (lead.service_type) {
        const departmentModel = require('../models/department.model');
        const departmentId = await departmentModel.getDepartmentIdByServiceType(lead.service_type);
        if (departmentId) {
          const staffId = await departmentModel.pickNextStaffForDepartment(departmentId);
         if (staffId) {
            finalLead = await leadModel.autoAssignLead(lead.id, staffId, departmentId);
            await leadModel.logAssignmentHistory(lead.id, staffId, 'auto_round_robin');
          } else {
            console.warn(`No available staff (all absent?) for department ${departmentId}`);
          }
        }
      }
    } catch (assignErr) {
      console.error('Auto-assign error (non-fatal):', assignErr);
    }

    res.json({ success: true, lead: finalLead });
  } catch (err) {
    console.error('Create lead error:', err);
    res.status(500).json({ success: false, message: 'Failed to create lead' });
  }
};

// GET /api/leads — View Enquiry (role aware)
const getAll = async (req, res) => {
  try {
    const { role } = req.user;
    const userId = req.user.id || req.user.userId || req.user._id;
    const { status, source, branch, keyword, dateFrom, dateTo } = req.query;

    const leads = await leadModel.getAllLeads({
      role,
      userId,
      filters: { status, source, branch, keyword, dateFrom, dateTo },
    });

    res.json({ success: true, total: leads.length, leads });
  } catch (err) {
    console.error('Get leads error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch leads' });
  }
};

// GET /api/leads/:id
const getById = async (req, res) => {
  try {
    const lead = await leadModel.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Employee can only view their own / assigned lead
    const { role } = req.user;
    const userId = req.user.id || req.user.userId || req.user._id;
    if (
      role !== 'chairman' &&
      role !== 'mis-executive' &&
      lead.created_by !== userId &&
      lead.assigned_to !== userId
    ) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this lead' });
    }

    res.json({ success: true, lead });
  } catch (err) {
    console.error('Get lead error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch lead' });
  }
};

// POST /api/leads/assign — single or bulk assign (screenshot 5 & 6 flow)
const assign = async (req, res) => {
  try {
    const { ids, branch, staff_id } = req.body; // ids = array of lead ids
    if (!ids || !ids.length || !branch || !staff_id) {
      return res.status(400).json({
        success: false,
        message: 'ids, branch and staff_id are required',
      });
    }

    // ── NEW: block manual assignment to an agent marked "Absent" today ──
    const departmentModel = require('../models/department.model');
    const redFlagCount = await departmentModel.getRedFlagCountToday(staff_id);
    if (redFlagCount >= 3) {
      return res.status(400).json({
        success: false,
        message: 'This staff member has 3+ Red Flags today and is marked Absent. Cannot assign leads to them today.',
      });
    }

    const assignedBy = req.user.id || req.user.userId || req.user._id;
    const updated = await leadModel.assignLeadsBulk(ids, branch, staff_id, assignedBy);

    res.json({ success: true, updated });
  } catch (err) {
    console.error('Assign lead error:', err);
    res.status(500).json({ success: false, message: 'Failed to assign lead' });
  }
};
// PUT /api/leads/:id/status — change status (Warm/Cold/Prospect/HOLD/etc.)
const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'status is required' });

    const lead = await leadModel.updateLeadStatus(req.params.id, status);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

// GET /api/leads/:id/notes
const getNotes = async (req, res) => {
  try {
    const notes = await leadModel.getNotesByLeadId(req.params.id);
    res.json({ success: true, notes });
  } catch (err) {
    console.error('Get notes error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notes' });
  }
};

// POST /api/leads/:id/notes
const addNote = async (req, res) => {
  try {
    const { remark } = req.body;
    if (!remark || !remark.trim()) {
      return res.status(400).json({ success: false, message: 'Remark is required' });
    }
    const commentedBy = req.user.id || req.user.userId || req.user._id;
    const note = await leadModel.addNoteToLead(req.params.id, req.body, commentedBy);
    res.json({ success: true, note });
  } catch (err) {
    console.error('Add note error:', err);
    res.status(500).json({ success: false, message: 'Failed to save note' });
  }
};

// GET /api/leads/:id/profile-history
const getProfileHistory = async (req, res) => {
  try {
    const data = await leadModel.getLeadProfileHistory(req.params.id);
    if (!data.lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Get profile history error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch profile history' });
  }
};

// ▼▼▼ NEW — paste this block right here ▼▼▼
// GET /api/leads/reminders/due — logged-in agent's own due reminders
const getDueReminders = async (req, res) => {
  try {
    const staffId = req.user.id || req.user.userId || req.user._id;
    const reminders = await leadModel.getDueReminders(staffId);
    res.json({ success: true, reminders });
  } catch (err) {
    console.error('Get due reminders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reminders' });
  }
};

// PUT /api/leads/reminders/:noteId/dismiss
const dismissReminder = async (req, res) => {
  try {
    const staffId = req.user.id || req.user.userId || req.user._id;
    const note = await leadModel.dismissReminder(req.params.noteId, staffId);
    if (!note) return res.status(404).json({ success: false, message: 'Reminder not found' });
    res.json({ success: true, note });
  } catch (err) {
    console.error('Dismiss reminder error:', err);
    res.status(500).json({ success: false, message: 'Failed to dismiss reminder' });
  }
};

// GET /api/leads/assignments/new — logged-in agent's un-notified assignments
const getNewAssignments = async (req, res) => {
  try {
    const staffId = req.user.id || req.user.userId || req.user._id;
    const assignments = await leadModel.getNewAssignments(staffId);
    res.json({ success: true, assignments });
  } catch (err) {
    console.error('Get new assignments error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch assignments' });
  }
};

// PUT /api/leads/assignments/:historyId/notified
const markAssignmentNotified = async (req, res) => {
  try {
    const staffId = req.user.id || req.user.userId || req.user._id;
    const row = await leadModel.markAssignmentNotified(req.params.historyId, staffId);
    if (!row) return res.status(404).json({ success: false, message: 'Assignment not found' });
    res.json({ success: true, row });
  } catch (err) {
    console.error('Mark assignment notified error:', err);
    res.status(500).json({ success: false, message: 'Failed to update' });
  }
};
// ▲▲▲ NEW block ends here ▲▲▲

// GET /api/leads/facebook/webhook — Meta verification handshake
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

// POST /api/leads/facebook/webhook — receive lead events
const receiveWebhookLead = async (req, res) => {
  console.log("🔥🔥 FACEBOOK WEBHOOK RECEIVED 🔥🔥");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const change = req.body.entry?.[0]?.changes?.[0];

if (!change || change.field !== 'leadgen') {
  return res.sendStatus(200);
}

const leadgenId = change.value.leadgen_id;

// Ignore Meta sample webhook payload
if (leadgenId === "444444444444") {
  console.log("Facebook sample webhook received.");
  return res.sendStatus(200);
}

const url =
  `https://graph.facebook.com/v24.0/${leadgenId}?fields=field_data,created_time,form_id,platform&access_token=${process.env.FB_PAGE_ACCESS_TOKEN}`;
console.log("Lead ID:", leadgenId);
console.log("Access Token Exists:", !!process.env.FB_PAGE_ACCESS_TOKEN);
console.log("Graph URL:", url);
const response = await axios.get(url);

// Debug: Print complete Graph API response
console.log("========== GRAPH API RESPONSE ==========");
console.log(JSON.stringify(response.data, null, 2));
console.log("========================================");

const fieldData = response.data.field_data || [];

// Meta's leadgen object returns "platform" as "ig" for Instagram-sourced
// leads. Anything else (or missing) defaults to "Facebook" — same as before.
const sourcePlatform = response.data.platform === "ig" ? "Instagram" : "Facebook";

const getField = (...names) => {
  const field = fieldData.find(f =>
    names.some(name =>
      f.name?.toLowerCase().includes(name.toLowerCase())
    )
  );
  return field?.values?.[0] || '';
};

// Any extra fields the client filled (education, work experience, etc.)
// beyond name/phone/email — joined into a readable summary for Last Remark.
const capturedNames = ["full_name", "name", "phone_number", "phone", "mobile", "email"];
const extraFieldsSummary = fieldData
  .filter(f => !capturedNames.some(n => f.name?.toLowerCase().includes(n)))
  .map(f => `${f.name} - ${f.values?.[0] || ''}`)
  .join(", ");

await leadModel.createLeadFromWebhook({
  lead_name:
  (getField("full_name", "name", "full name") || "Facebook Lead").substring(0, 150),

contact_number:
  (getField("phone_number", "phone", "mobile") || "").substring(0, 20),

  email:
    getField("email", "email address"),

source: sourcePlatform,
last_remark: extraFieldsSummary || null,
});
    return res.sendStatus(200);
  } catch (err) {
    console.error("FACEBOOK ERROR:");
console.log(JSON.stringify(err.response?.data || err, null, 2));
    return res.sendStatus(200);
  }
};

module.exports = {
  create, getAll, getById, assign, updateStatus, getNotes, addNote, getProfileHistory,
  verifyWebhook,
  receiveWebhookLead,
  getDueReminders,
  dismissReminder,
  getNewAssignments,
  markAssignmentNotified,
};