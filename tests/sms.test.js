'use strict';
// Real-SMS OTP login through the actual HTTP server, with local stand-ins for
// the Twilio Verify and MSG91 APIs (same endpoints, auth and payloads). The
// stand-in "phone inbox" lets the test read the code the way a user would.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PHONE = '8077060610';

function fakeProviders() {
  const inbox = [];
  const pending = new Map();
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
      // Twilio Verify
      if (url.pathname.startsWith('/v2/Services/')) {
        if (req.headers.authorization !== 'Basic ' + Buffer.from('ACtest:secret').toString('base64')) return json(401, { code: 20003, message: 'Authenticate' });
        const p = new URLSearchParams(raw);
        if (url.pathname.endsWith('/Verifications')) {
          const code = String(Math.floor(100000 + Math.random() * 900000));
          pending.set(p.get('To'), code);
          inbox.push({ via: 'twilio', to: p.get('To'), text: `Your Aayuvridhi verification code is: ${code}` });
          return json(201, { status: 'pending', to: p.get('To'), channel: p.get('Channel') });
        }
        if (url.pathname.endsWith('/VerificationCheck')) {
          if (!pending.has(p.get('To'))) return json(404, { code: 20404, message: 'not found' });
          const ok = pending.get(p.get('To')) === p.get('Code');
          if (ok) pending.delete(p.get('To'));
          return json(200, { status: ok ? 'approved' : 'pending' });
        }
      }
      // MSG91 OTP
      if (url.pathname === '/api/v5/otp') {
        if (req.headers.authkey !== 'msgkey') return json(401, { type: 'error', message: 'Invalid authkey' });
        inbox.push({ via: 'msg91', to: url.searchParams.get('mobile'), text: `${url.searchParams.get('otp')} is your Aayuvridhi OTP` });
        return json(200, { type: 'success', request_id: 'r1' });
      }
      json(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, inbox, base: `http://127.0.0.1:${srv.address().port}` })));
}

function startApp(env) {
  const port = 3300 + Math.floor(Math.random() * 500);
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ay-')), 'test.db');
  const child = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), DB_PATH: db }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const ready = new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () =>
      fetch(base + '/api/health').then((r) => r.json()).then(resolve, () => (Date.now() - t0 > 8000 ? reject(new Error(log)) : setTimeout(poll, 150)));
    poll();
  });
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  return { child, ready, post, base, log: () => log };
}

const codeFrom = (msg) => msg.text.match(/\d{6}/)[0];

test('Twilio Verify: OTP texted to 8077060610, wrong code rejected, right code logs in', async () => {
  const fake = await fakeProviders();
  const app = startApp({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'secret', TWILIO_VERIFY_SERVICE_SID: 'VAtest', TWILIO_VERIFY_BASE: fake.base });
  try {
    const h = await app.ready;
    assert.equal(h.sms, 'twilio');
    const r1 = await app.post('/api/auth/otp/request', { phone: PHONE });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.channel, 'sms');
    assert.equal(r1.body.demo_code, undefined, 'no demo code leaked');
    assert.equal(fake.inbox.length, 1);
    assert.equal(fake.inbox[0].to, '+918077060610');
    const again = await app.post('/api/auth/otp/request', { phone: PHONE });
    assert.equal(again.status, 429, 'resend cooldown');
    const wrong = await app.post('/api/auth/otp/verify', { phone: PHONE, code: '000000', name: 'Aaryansh Rathore' });
    assert.equal(wrong.status, 400);
    const noName = await app.post('/api/auth/otp/verify', { phone: PHONE, code: codeFrom(fake.inbox[0]) });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/);
    const ok = await app.post('/api/auth/otp/verify', { phone: PHONE, code: codeFrom(fake.inbox[0]), name: 'Aaryansh Rathore' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.phone, PHONE);
    assert.equal(ok.body.user.name, 'Aaryansh Rathore');
    const me = await fetch(app.base + '/api/me', { headers: { authorization: 'Bearer ' + ok.body.token } }).then((r) => r.json());
    assert.equal(me.user.name, 'Aaryansh Rathore');
    // Demo numbers never send a real SMS
    const demo = await app.post('/api/auth/otp/request', { phone: '9876500001' });
    assert.equal(demo.body.demo_code, '123456');
    assert.equal(fake.inbox.length, 1);
  } finally {
    app.child.kill();
    fake.srv.close();
  }
});

test('MSG91: server generates the code and MSG91 delivers it', async () => {
  const fake = await fakeProviders();
  const app = startApp({ SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'msgkey', MSG91_TEMPLATE_ID: 'tmpl', MSG91_BASE: fake.base });
  try {
    await app.ready;
    const r1 = await app.post('/api/auth/otp/request', { phone: PHONE });
    assert.equal(r1.status, 200);
    assert.equal(fake.inbox[0].to, '918077060610');
    const ok = await app.post('/api/auth/otp/verify', { phone: PHONE, code: codeFrom(fake.inbox[0]), name: 'Aaryansh Rathore' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(!/\d{6}/.test(app.log().split('\n').filter((l) => l.includes('sms:')).join(' ')), 'OTP never printed in logs');
  } finally {
    app.child.kill();
    fake.srv.close();
  }
});

test('Provider down or wrong key: user sees a clear error, no session', async () => {
  const fake = await fakeProviders();
  const app = startApp({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'WRONG', TWILIO_VERIFY_SERVICE_SID: 'VAtest', TWILIO_VERIFY_BASE: fake.base });
  try {
    await app.ready;
    const r = await app.post('/api/auth/otp/request', { phone: PHONE });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Could not send/);
    assert.match(app.log(), /Authenticate/);
  } finally {
    app.child.kill();
    fake.srv.close();
  }
});
