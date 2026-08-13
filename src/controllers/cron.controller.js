const leadModel = require('../models/lead.model');
const departmentModel = require('../models/department.model');

// GET /api/cron/sla-check?secret=YOUR_SECRET
//
// Called every 1 minute by an external cron service (e.g. cron-job.org).
// For every lead whose 30-min SLA has expired and the assigned agent hasn't
// acted on it:
//   1. Log a Red Flag for that agent
//   2. Auto-shuffle the lead to the next available agent (round-robin,
//      skipping agents who already have 3+ red flags today)
//   3. Reset the 30-min timer for the new agent
const slaCheck = async (req, res) => {
  // Simple protection so random people on the internet can't spam-trigger this.
  // Set CRON_SECRET in your Vercel environment variables, and put the same
  // value in the cron-job.org URL as ?secret=...
  if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const results = { checked: 0, flagged: 0, reassigned: 0, errors: 0 };

  try {
    const expiredLeads = await leadModel.getExpiredSlaLeads();
    results.checked = expiredLeads.length;

    for (const lead of expiredLeads) {
      try {
        // 1. Red flag the current agent for missing this lead's SLA
        await departmentModel.addRedFlag(lead.assigned_to, lead.id);
        results.flagged += 1;

        if (!lead.department_id) {
          // No department on this lead — can't auto-shuffle, just mark handled
          await leadModel.markRedFlagTriggered(lead.id);
          continue;
        }

        // 2. Find the next available agent (excluding the one who just missed it)
        const nextStaffId = await departmentModel.pickNextStaffForDepartment(
          lead.department_id,
          lead.assigned_to
        );

        if (nextStaffId) {
          // 3. Auto-shuffle: reassign + reset 30-min timer
          await leadModel.autoAssignLead(lead.id, nextStaffId, lead.department_id);
          results.reassigned += 1;
        } else {
          // Nobody else available (everyone absent today / only 1 staff in dept)
          await leadModel.markRedFlagTriggered(lead.id);
        }
      } catch (innerErr) {
        console.error(`[SLA-CHECK] Error processing lead ${lead.id}:`, innerErr);
        results.errors += 1;
        // Continue to next lead even if one fails
      }
    }

    console.log('[SLA-CHECK] Run complete:', results);
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('[SLA-CHECK] Fatal error:', err);
    res.status(500).json({ success: false, message: 'SLA check failed' });
  }
};

module.exports = { slaCheck };