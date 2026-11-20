require('dotenv').config();
const axios = require('axios');

const to = process.argv[2];
if (!to) { console.log('Number ivvandi: node test-wa.js 919XXXXXXXXX'); process.exit(1); }

axios.post(
  `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID.trim()}/messages`,
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
          { type: 'text', text: 'Test Staff' },
          { type: 'text', text: 'Test Lead' },
          { type: 'text', text: 'Assigned to you (manual)' },
        ],
      }],
    },
  },
  { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}` } }
)
  .then((r) => console.log('OK:', JSON.stringify(r.data)))
  .catch((e) => console.log('ERROR:', JSON.stringify(e.response?.data || e.message)));