// src/services/whatsapp.service.js
// ── WhatsApp Cloud API notifier — fires when a lead is assigned/shuffled ──
// Fully isolated from lead-assignment / round-robin flow. Every failure
// here (missing env vars, no office_number, Meta API error) is caught
// INTERNALLY — this file can NEVER break lead assignment, round-robin,
// or the existing desktop notification feature.
const axios = require('axios');
const pool = require('../config/db');

const REASON_TEXT = {
  auto_round_robin:                 'Assigned to you (round-robin, auto)',
  auto_round_robin_on_login:        'Assigned to you (round-robin, auto)',
  auto_round_robin_fb:              'Assigned to you (round-robin, auto — Facebook lead)',
  auto_round_robin_manual_classify: 'Assigned to you (round-robin, auto)',
  manual_walkin:                    'Assigned to you (manual)',
  manual:                           'Assigned to you (manual)',
  auto_shuffle_sla_breach:          'Shuffled to you from another agent',
};

const sendAssignmentWhatsapp = async (leadId, staffId, reason) => {
  try {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return;
    if (!leadId || !staffId) return;

    const { rows: staffRows } = await pool.query(
      `SELECT name, office_number FROM users WHERE id = $1`,
      [staffId]
    );
    const staff = staffRows[0];
    if (!staff || !staff.office_number) return; // number set చేయకపోతే silent skip

    const { rows: leadRows } = await pool.query(
      `SELECT lead_name FROM leads WHERE id = $1`,
      [leadId]
    );
    const leadName = leadRows[0]?.lead_name || 'a lead';
    const statusText = REASON_TEXT[reason] || 'Assigned to you';

    await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: staff.office_number,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME || 'lead_assigned',
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en_US' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: staff.name || 'there' },
              { type: 'text', text: leadName },
              { type: 'text', text: statusText },
            ],
          }],
        },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
  } catch (err) {
    console.error('[WHATSAPP] send error (non-fatal):', err.response?.data || err.message);
  }
};

module.exports = { sendAssignmentWhatsapp };