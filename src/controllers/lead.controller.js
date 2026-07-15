const leadModel = require('../models/lead.model');

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

    // req.user is set by verifyToken middleware -> { id, name, role, branch }
    const createdBy = req.user.id || req.user.userId || req.user._id;
    const lead = await leadModel.createLead(
      { ...req.body, branch: req.body.branch || req.user.location },
      createdBy
    );

    res.json({ success: true, lead });
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

module.exports = { create, getAll, getById, assign, updateStatus };
