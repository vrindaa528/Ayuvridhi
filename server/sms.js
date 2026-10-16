'use strict';
// Real OTP delivery. Pick one with SMS_PROVIDER:
//
//   twilio  Twilio Verify — Twilio generates, sends and checks the code and
//           handles India's DLT rules itself. Easiest way to test on your own
//           phone: a free trial account can text numbers you verify in the
//           Twilio console.
//           TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
//
//   msg91   MSG91 OTP API — we generate the code, MSG91 sends it on your
//           DLT-approved template. The usual production choice in India.
//           MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
//
// Unset → no SMS is sent and OTPs are printed to the server console.

function form(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function call(url, opts, label) {
  let res;
  try {
    res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(10000) }, opts));
  } catch (e) {
    throw new Error(`${label}: could not reach the SMS provider (${e.cause ? e.cause.code || e.cause.message : e.message})`);
  }
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function twilio(env) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const service = env.TWILIO_VERIFY_SERVICE_SID;
  const base = (env.TWILIO_VERIFY_BASE || 'https://verify.twilio.com').replace(/\/$/, '');
  if (!sid || !token || !service) throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID');
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' };
  return {
    name: 'twilio',
    mode: 'external',
    async start(phone) {
      const r = await call(`${base}/v2/Services/${service}/Verifications`, { method: 'POST', headers, body: form({ To: `+91${phone}`, Channel: 'sms' }) }, 'Twilio');
      if (r.status >= 300) throw new Error(`Twilio: ${r.data.message || 'could not send OTP'} (code ${r.data.code || r.status})`);
    },
    async check(phone, code) {
      const r = await call(`${base}/v2/Services/${service}/VerificationCheck`, { method: 'POST', headers, body: form({ To: `+91${phone}`, Code: String(code) }) }, 'Twilio');
      if (r.status === 404) return false; // expired or already used
      if (r.status >= 300) throw new Error(`Twilio: ${r.data.message || 'could not check OTP'} (code ${r.data.code || r.status})`);
      return r.data.status === 'approved';
    },
  };
}

function msg91(env) {
  const key = env.MSG91_AUTH_KEY;
  const template = env.MSG91_TEMPLATE_ID;
  const base = (env.MSG91_BASE || 'https://control.msg91.com').replace(/\/$/, '');
  if (!key || !template) throw new Error('SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
  return {
    name: 'msg91',
    mode: 'sms',
    async send(phone, code) {
      const url = `${base}/api/v5/otp?${form({ template_id: template, mobile: `91${phone}`, otp: code, otp_expiry: 15 })}`;
      const r = await call(url, { method: 'POST', headers: { authkey: key, 'Content-Type': 'application/json' }, body: '{}' }, 'MSG91');
      if (r.status >= 300 || r.data.type === 'error') throw new Error(`MSG91: ${r.data.message || 'could not send OTP'}`);
    },
  };
}

function fromEnv(env) {
  const p = String(env.SMS_PROVIDER || '').toLowerCase();
  if (!p || p === 'none' || p === 'console') return null;
  if (p === 'twilio') return twilio(env);
  if (p === 'msg91') return msg91(env);
  throw new Error(`Unknown SMS_PROVIDER "${env.SMS_PROVIDER}" (use twilio or msg91)`);
}

module.exports = { fromEnv };
