const departmentModel = require('../models/department.model');
const leadModel = require('../models/lead.model');

// GET /api/departments
const getAll = async (req, res) => {
  try {
    await departmentModel.ensureTables();
    const departments = await departmentModel.getAllDepartments();
    res.json({ success: true, departments });
  } catch (err) {
    console.error('Get departments error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch departments' });
  }
};

// POST /api/departments/:id/staff  { staff_id }
const addStaff = async (req, res) => {
  try {
    const { staff_id } = req.body;
    if (!staff_id) {
      return res.status(400).json({ success: false, message: 'staff_id is required' });
    }
    await departmentModel.addStaffToDepartment(req.params.id, staff_id);
    res.json({ success: true });
  } catch (err) {
    console.error('Add staff to department error:', err);
    res.status(500).json({ success: false, message: 'Failed to add staff' });
  }
};

// DELETE /api/departments/:id/staff/:staffId
const removeStaff = async (req, res) => {
  try {
    await departmentModel.removeStaffFromDepartment(req.params.id, req.params.staffId);
    res.json({ success: true });
  } catch (err) {
    console.error('Remove staff from department error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove staff' });
  }
};

// POST /api/departments/staff/online  { email }
// POST /api/departments/staff/offline { email }
const setOnlineStatus = (isOnline) => async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'email is required' });
    const updated = await departmentModel.setStaffOnlineByEmail(email, isOnline);

    // ▼▼▼ NEW — when an employee comes online, drain any pending leads
    // waiting for their department(s), oldest first, via round-robin ▼▼▼
    if (isOnline) {
      for (const row of updated) {
        if (!row.department_id) continue;
        let pendingLeads = await leadModel.getPendingLeadsForDepartment(row.department_id);
        for (const lead of pendingLeads) {
          const staffId = await departmentModel.pickNextStaffForDepartment(row.department_id);
          if (!staffId) break; // nobody online in this department anymore
          await leadModel.autoAssignLead(lead.id, staffId, row.department_id);
          await leadModel.logAssignmentHistory(lead.id, staffId, 'auto_round_robin_on_login');
        }
      }
    }
    // ▲▲▲ NEW block ends here ▲▲▲

    res.json({ success: true, updated: updated.length });
  } catch (err) {
    console.error('Set online status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

// GET /api/departments/daily-reset?secret=YOUR_SECRET
// Called once a day (e.g. 12:05 AM) by an external cron service (cron-job.org),
// same pattern as /api/cron/sla-check. Resets everyone offline so a stuck
// is_online flag from a missed/failed checkout never carries into the next day.
const dailyReset = async (req, res) => {
  if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const pool = require('../config/db');
    const result = await pool.query(`UPDATE department_staff SET is_online = false`);
    console.log('[DAILY-RESET] Reset is_online for', result.rowCount, 'staff rows');
    res.json({ success: true, reset_count: result.rowCount });
  } catch (err) {
    console.error('[DAILY-RESET] Fatal error:', err);
    res.status(500).json({ success: false, message: 'Daily reset failed' });
  }
};

module.exports = {
  getAll,
  addStaff,
  removeStaff,
  setOnline: setOnlineStatus(true),
  setOffline: setOnlineStatus(false),
  dailyReset,
};