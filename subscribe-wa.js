require('dotenv').config();
const axios = require('axios');
const T = process.env.WHATSAPP_TOKEN.trim();
const WABA = '1173051891372721';

axios.post(`https://graph.facebook.com/v22.0/${WABA}/subscribed_apps`, {}, {
  headers: { Authorization: `Bearer ${T}` },
})
  .then(r => console.log('SUBSCRIBE OK:', JSON.stringify(r.data)))
  .catch(e => console.log('SUBSCRIBE ERROR:', JSON.stringify(e.response?.data || e.message)));