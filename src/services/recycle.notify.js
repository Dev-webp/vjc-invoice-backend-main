// NEW FILE — sends the "no activity" reminder to the consultant. Does NOT modify whatsapp.service.js.
// Re-uses the SAME WhatsApp env vars / template as lead assignments (3 text params: name, lead, text).
const axios = require('axios');
const pool = require('../config/db');

const cleanNumber = (raw) => {
  let n = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (n.length === 10) n = '91' + n;
  return n;
};
const cleanParam = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';

const sendReminderWhatsapp = async (leadId, staffId, text) => {
  try {
    const token = (process.env.WHATSAPP_TOKEN || '').trim();
    const phoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!token || !phoneId) return 'skipped:no-env';
    const { rows: s } = await pool.query(`SELECT name, office_number FROM users WHERE id = $1`, [staffId]);
    const { rows: l } = await pool.query(`SELECT lead_name FROM leads WHERE id = $1`, [leadId]);
    const to = cleanNumber(s[0]?.office_number);
    if (!s[0] || !to) return 'skipped:no-number';
    await axios.post(
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
              { type: 'text', text: cleanParam(s[0].name || 'there') },
              { type: 'text', text: cleanParam(l[0]?.lead_name || 'a lead') },
              { type: 'text', text: cleanParam(text) },
            ],
          }],
        },
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    return 'whatsapp';
  } catch (err) {
    console.error('[RECYCLE] reminder send error (non-fatal):', JSON.stringify(err.response?.data || err.message));
    return 'failed';
  }
};

module.exports = { sendReminderWhatsapp };