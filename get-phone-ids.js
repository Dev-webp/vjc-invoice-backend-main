require('dotenv').config();
const axios = require('axios');

axios.get('https://graph.facebook.com/v22.0/1173051891372721/phone_numbers', {
  params: { fields: 'id,display_phone_number,verified_name' },
  headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}` },
})
  .then((r) => console.log(JSON.stringify(r.data, null, 2)))
  .catch((e) => console.log('ERROR:', JSON.stringify(e.response?.data || e.message)));