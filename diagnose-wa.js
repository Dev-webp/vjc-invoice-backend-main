require('dotenv').config();
const axios = require('axios');
const T = process.env.WHATSAPP_TOKEN.trim();
const PID = process.env.WHATSAPP_PHONE_NUMBER_ID.trim();
const WABA = '1173051891372721';
const g = (url, params = {}) =>
  axios.get(`https://graph.facebook.com/v22.0/${url}`, { params, headers: { Authorization: `Bearer ${T}` } })
    .then(r => r.data).catch(e => ({ ERROR: e.response?.data?.error?.message || e.message }));

(async () => {
  console.log('token starts with:', T.slice(0, 8), '| length:', T.length);
  const d = await axios.get('https://graph.facebook.com/debug_token', { params: { input_token: T, access_token: T } })
    .then(r => r.data.data).catch(e => ({ ERROR: e.response?.data || e.message }));
  console.log('\n1) TOKEN INFO:', JSON.stringify({ app: d.application, app_id: d.app_id, type: d.type, expires: d.expires_at, scopes: d.scopes, granular: d.granular_scopes, error: d.ERROR }, null, 2));
  console.log('\n2) PHONE ID:', JSON.stringify(await g(PID, { fields: 'id,display_phone_number,verified_name,quality_rating' })));
  console.log('\n3) WABA phone numbers:', JSON.stringify(await g(`${WABA}/phone_numbers`, { fields: 'id,display_phone_number' })));
  console.log('\n4) Template:', JSON.stringify(await g(`${WABA}/message_templates`, { name: 'lead_assigned', fields: 'name,status,language' })));
    console.log('\nTOKEN last 6:', T.slice(-6), '| issued_at:', d.issued_at ? new Date(d.issued_at * 1000).toLocaleString() : 'n/a');
  console.log('\n5) WABA assigned users:', JSON.stringify(await g(`${WABA}/assigned_users`, { business: '263225297634090' })));
  console.log('\n6) Apps owned/client:', JSON.stringify(await g('263225297634090/owned_apps', { fields: 'id,name' })));
    console.log('\nTOKEN user_id:', d.user_id, '| profile_id:', d.profile_id);
  console.log('\n7) subscribed apps:', JSON.stringify(await g(`${WABA}/subscribed_apps`)));
    console.log('\n8) PHONE DETAILS:', JSON.stringify(await g(PID, { fields: 'platform_type,account_mode,code_verification_status,status,name_status,throughput,health_status,is_official_business_account' }), null, 2));
})();