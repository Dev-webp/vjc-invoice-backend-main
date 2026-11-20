// src/services/whatsapp.service.js
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

// digits only, country code tho (10 digits ayite India 91 add)
const cleanNumber = (raw) => {
  let n = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (n.length === 10) n = '91' + n;
  return n;
};

// template params lo newline/tab/extra spaces raakoodadu
const cleanParam = (v) =>
  String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';

const sendAssignmentWhatsapp = async (leadId, staffId, reason) => {
  try {
    const token = (process.env.WHATSAPP_TOKEN || '').trim();
    const phoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!token || !phoneId) {
      console.warn('[WHATSAPP] skipped: WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing in environment');
      return;
    }
    if (!leadId || !staffId) {
      console.warn('[WHATSAPP] skipped: leadId or staffId missing', { leadId, staffId });
      return;
    }

    const { rows: staffRows } = await pool.query(
      `SELECT name, office_number FROM users WHERE id = $1`,
      [staffId]
    );
    const staff = staffRows[0];
    const to = cleanNumber(staff?.office_number);
    if (!staff || !to) {
      console.warn('[WHATSAPP] skipped: no office_number for staff', staffId);
      return;
    }

    const { rows: leadRows } = await pool.query(
      `SELECT lead_name FROM leads WHERE id = $1`,
      [leadId]
    );
    const leadName = leadRows[0]?.lead_name || 'a lead';
    const statusText = REASON_TEXT[reason] || 'Assigned to you';

    const res = await axios.post(
      `https://graph.facebook.com/v22.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: (process.env.WHATSAPP_TEMPLATE_NAME || 'lead_assigned').trim(),
          language: { code: (process.env.WHATSAPP_TEMPLATE_LANG || 'en_US').trim() },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: cleanParam(staff.name || 'there') },
              { type: 'text', text: cleanParam(leadName) },
              { type: 'text', text: cleanParam(statusText) },
            ],
          }],
        },
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    console.log('[WHATSAPP] sent to', to, 'id:', res.data?.messages?.[0]?.id);
  } catch (err) {
    console.error('[WHATSAPP] send error (non-fatal):', JSON.stringify(err.response?.data || err.message));
  }
};

module.exports = { sendAssignmentWhatsapp };