'use strict';
// Phase 1 security: role gates on every staff route, ownership between
// providers, hashed codes, rate limits, validation and audit trail.

process.env.TZ = 'Asia/Kolkata';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createCore } = require('../core/app');
const { seed } = require('../core/seed');
const { openDb } = require('../server/db-node');

const KEY = 'test-key';
const hmac = (m) => crypto.createHmac('sha256', KEY).update(m).digest('hex');

function makeCore(opts) {
  const o = Object.assign({ demoMode: true, demoOtp: '123456' }, opts || {});
  let clock = new Date('2026-10-17T10:00:00+05:30');
  const core = createCore(
    Object.assign(
      {
        db: openDb(':memory:'),
        now: () => new Date(clock),
        sign: (p) => Buffer.from(JSON.stringify(p)).toString('base64'),
        verify: (t) => {
          try {
            return JSON.parse(Buffer.from(t, 'base64').toString());
          } catch (e) {
            return null;
          }
        },
        hmac,
        autoConfirmSeconds: 0,
      },
      o
    )
  );
  core.setClock = (d) => (clock = d);
  core.advance = (sec) => (clock = new Date(clock.getTime() + sec * 1000));
  if (seed(core)) core.seeded = true;
  return core;
}

function client(core, ip) {
  let token = null;
  const call = (method, url, body) => {
    const out = core.handle(method, url, body, Object.assign({ 'x-client-ip': ip || '10.0.0.1' }, token ? { authorization: `Bearer ${token}` } : {}));
    if (out.status >= 400) {
      const e = new Error(`${method} ${url} → ${out.status} ${out.body.error}`);
      e.status = out.status;
      e.body = out.body;
      throw e;
    }
    return out.body;
  };
  return {
    raw: (method, url, body) => core.handle(method, url, body, Object.assign({ 'x-client-ip': ip || '10.0.0.1' }, token ? { authorization: `Bearer ${token}` } : {})),
    login(phone, name) {
      call('POST', '/api/auth/otp/request', { phone });
      token = call('POST', '/api/auth/otp/verify', { phone, code: '123456', name }).token;
      return this;
    },
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    put: (u, b) => call('PUT', u, b),
  };
}

const sample = (url) => url.replace(/:[a-zA-Z_]+/g, 'x1');

test('every /api/provider and /api/admin route refuses a patient (403) and anonymous calls (401)', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const anon = client(core);
  const staffRoutes = core.routes.filter((r) => r.pattern.startsWith('/api/provider/') || r.pattern.startsWith('/api/admin/'));
  assert.ok(staffRoutes.length >= 14, `found ${staffRoutes.length} staff routes`);
  for (const r of staffRoutes) {
    const url = sample(r.pattern);
    const asPatient = raj.raw(r.method, url, { decision: 'approve', items: [] });
    assert.equal(asPatient.status, 403, `${r.method} ${r.pattern} must refuse a patient, got ${asPatient.status}`);
    const asAnon = anon.raw(r.method, url, {});
    assert.equal(asAnon.status, 401, `${r.method} ${r.pattern} must refuse anonymous calls`);
  }
});

test('ops-only admin routes refuse provider staff; ops can use them', () => {
  const core = makeCore();
  const doc = client(core).login('9876500051');
  assert.throws(() => doc.get('/api/admin/providers'), /403/);
  assert.throws(() => doc.get('/api/admin/metrics'), /403/);
  const ops = client(core).login('9876500099');
  assert.ok(ops.get('/api/admin/metrics').users > 0);
});

test('a doctor confirms only their own bookings; another doctor gets 403', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const anilSlot = raj.get('/api/providers/prv_doc_anil/slots?date=' + new Date(Date.now() + 864e5).toISOString().slice(0, 10)).items.find((s) => s.status === 'open');
  const b = raj.post('/api/bookings', { slot_id: anilSlot.id, member_id: 'usr_kamla' });
  const priya = client(core).login('9876500051');
  assert.throws(() => priya.post(`/api/provider/bookings/${b.id}/confirm`), /403/);
  const anil = client(core).login('9876500052');
  assert.equal(anil.post(`/api/provider/bookings/${b.id}/confirm`).status, 'confirmed');
});

test('a doctor cannot write a prescription for another doctor’s booking', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const slot = raj.get('/api/providers/prv_doc_anil/slots?date=' + new Date(Date.now() + 864e5).toISOString().slice(0, 10)).items.find((s) => s.status === 'open');
  const b = raj.post('/api/bookings', { slot_id: slot.id, member_id: 'usr_kamla' });
  client(core).login('9876500052').post(`/api/provider/bookings/${b.id}/confirm`);
  const items = [{ drug: 'Cetirizine 10mg', dose: '1 tablet', frequency: '0-0-1', days: 3 }];
  assert.throws(() => client(core).login('9876500051').post(`/api/provider/consultations/${b.id}/prescription`, { items }), /403/);
  assert.throws(() => client(core).login('9876500071').post(`/api/provider/consultations/${b.id}/prescription`, { items }), /403/, 'lab cannot issue Rx');
  assert.ok(client(core).login('9876500052').post(`/api/provider/consultations/${b.id}/prescription`, { items }).signed);
});

test('a pharmacy can verify and dispatch only its own orders', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const order = raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'ORS sachet', qty: 2 }] });
  const other = client(core).login('9876500062'); // HealthFirst
  assert.throws(() => other.post(`/api/provider/orders/${order.id}/verify`, {}), /403/);
  const own = client(core).login('9876500061'); // Sanjeevani
  assert.equal(own.post(`/api/provider/orders/${order.id}/verify`, {}).status, 'verified');
  assert.throws(() => other.post(`/api/provider/orders/${order.id}/dispatch`), /403/);
});

test('the rider role can hand over orders of its own pharmacy only', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const order = raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'ORS sachet', qty: 2 }] });
  const pharm = client(core).login('9876500061');
  pharm.post(`/api/provider/orders/${order.id}/verify`, {});
  pharm.post(`/api/provider/orders/${order.id}/dispatch`);
  const otp = raj.get(`/api/orders/${order.id}`).otp;
  assert.ok(otp && /^\d{4}$/.test(otp));
  assert.throws(() => client(core).login('9876500062').post(`/api/provider/orders/${order.id}/handover`, { otp }), /403/);
  assert.equal(client(core).login('9876500081').post(`/api/provider/orders/${order.id}/handover`, { otp }).status, 'delivered');
});

test('revoking a staff link takes effect on the next request', () => {
  const core = makeCore();
  const anil = client(core).login('9876500052');
  assert.ok(anil.get('/api/provider/queue').bookings !== undefined);
  const ops = client(core).login('9876500099');
  const anilUser = core.c.db.get("SELECT id FROM users WHERE phone = '9876500052'");
  ops.post('/api/admin/provider-accounts/revoke', { user_id: anilUser.id, provider_id: 'prv_doc_anil' });
  assert.throws(() => anil.get('/api/provider/queue'), /403/);
});

test('ops can link a new staff login to a provider, but only with a matching role', () => {
  const core = makeCore();
  const ops = client(core).login('9876500099');
  assert.throws(() => ops.post('/api/admin/provider-accounts', { phone: '9123400001', provider_id: 'prv_doc_anil', role: 'pharmacy' }), /cannot be linked/);
  const r = ops.post('/api/admin/provider-accounts', { phone: '9123400001', provider_id: 'prv_doc_anil', role: 'doctor', name: 'Dr Test' });
  assert.equal(r.role, 'doctor');
  const doc = client(core).login('9123400001', 'Dr Test');
  assert.equal(doc.get('/api/me').user.role, 'doctor');
  assert.deepEqual(doc.get('/api/me').providers, ['prv_doc_anil']);
});

test('patients cannot use demo staff sign-in or change their own role', () => {
  const core = makeCore({ demoMode: false });
  const out = core.handle('POST', '/api/demo/partner-token', { role: 'ops' }, {});
  assert.equal(out.status, 403);
  const core2 = makeCore();
  const raj = client(core2).login('9876500001');
  raj.put('/api/me', { name: 'Rajesh Kumar', role: 'ops' });
  assert.equal(raj.get('/api/me').user.role, 'patient');
});

test('login codes are stored as keyed hashes, never as the code', () => {
  const core = makeCore({ demoOtp: null, otpMode: null });
  const logs = [];
  core.c.log = (kind, msg) => logs.push(msg);
  const ip = '10.0.0.9';
  core.handle('POST', '/api/auth/otp/request', { phone: '9123456780' }, { 'x-client-ip': ip });
  const code = logs.join(' ').match(/OTP for \d+: (\d{6})/)[1];
  const rows = core.c.db.all('SELECT * FROM otps', []);
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(code), 'code must not appear in the otps table');
  assert.equal(rows[0].code_hash, hmac(`otp|9123456780|${code}`));
  const ok = core.handle('POST', '/api/auth/otp/verify', { phone: '9123456780', code, name: 'Test' }, { 'x-client-ip': ip });
  assert.equal(ok.status, 200);
});

test('delivery code is never stored: not in orders, deliveries or notifications', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const order = raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'ORS sachet', qty: 2 }] });
  const pharm = client(core).login('9876500061');
  pharm.post(`/api/provider/orders/${order.id}/verify`, {});
  pharm.post(`/api/provider/orders/${order.id}/dispatch`);
  const code = raj.get(`/api/orders/${order.id}`).otp;
  const dump = JSON.stringify([
    core.c.db.all('SELECT * FROM orders WHERE id = ?', [order.id]),
    core.c.db.all('SELECT * FROM deliveries WHERE order_id = ?', [order.id]),
    core.c.db.all('SELECT * FROM notifications WHERE user_id = ?', ['usr_rajesh']),
  ]);
  assert.ok(!dump.includes(`"${code}"`), 'code must not be stored');
  assert.ok(!dump.includes(code), 'code must not appear in stored rows');
  assert.equal(core.c.db.all('PRAGMA table_info(orders)', []).some((c0) => c0.name === 'otp_plain'), false);
  // Pharmacy views never show the code.
  const view = pharm.get(`/api/provider/queue`).orders.find((o) => o.id === order.id);
  assert.equal(view.otp, undefined);
  assert.equal(view.otp_hash, undefined);
});

test('delivery code stops showing to the patient after the delivery window', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const order = raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'ORS sachet', qty: 2 }] });
  const pharm = client(core).login('9876500061');
  pharm.post(`/api/provider/orders/${order.id}/verify`, {});
  pharm.post(`/api/provider/orders/${order.id}/dispatch`);
  assert.ok(raj.get(`/api/orders/${order.id}`).otp);
  core.advance(13 * 3600);
  assert.equal(raj.get(`/api/orders/${order.id}`).otp, undefined);
});

test('wrong handover codes lock the order after three attempts, and are audited', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const order = raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'ORS sachet', qty: 2 }] });
  const pharm = client(core).login('9876500061');
  pharm.post(`/api/provider/orders/${order.id}/verify`, {});
  pharm.post(`/api/provider/orders/${order.id}/dispatch`);
  const code = raj.get(`/api/orders/${order.id}`).otp;
  const wrong = code === '1111' ? '2222' : '1111';
  for (let i = 0; i < 3; i++) assert.throws(() => pharm.post(`/api/provider/orders/${order.id}/handover`, { otp: wrong }), /Wrong OTP|blocked/);
  assert.throws(() => pharm.post(`/api/provider/orders/${order.id}/handover`, { otp: code }), /423|blocked/);
  const logs = core.c.db.all("SELECT action FROM access_logs WHERE action = 'handover.wrong_otp'", []);
  assert.ok(logs.length >= 3);
});

test('staff actions are written to the audit log with the actor and IP', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const slot = raj.get('/api/providers/prv_doc_anil/slots?date=' + new Date(Date.now() + 864e5).toISOString().slice(0, 10)).items.find((s) => s.status === 'open');
  const b = raj.post('/api/bookings', { slot_id: slot.id });
  client(core, '203.0.113.7').login('9876500052').post(`/api/provider/bookings/${b.id}/confirm`);
  const row = core.c.db.get("SELECT * FROM access_logs WHERE action = 'booking.confirm'", []);
  assert.ok(row, 'booking.confirm logged');
  assert.equal(row.ip, '203.0.113.7');
  assert.equal(row.actor_id, core.c.db.get("SELECT id FROM users WHERE phone = '9876500052'").id);
  assert.throws(() => client(core, '198.51.100.4').login('9876500051').post(`/api/provider/bookings/${b.id}/confirm`), /403|400/);
  const denied = core.c.db.get("SELECT * FROM access_logs WHERE action = 'access_denied' AND ip = '198.51.100.4'", []);
  assert.ok(denied, 'denied attempt logged with IP');
});

test('OTP requests are rate limited per IP and per phone', () => {
  const core = makeCore();
  const phone = '9123456701';
  for (let i = 0; i < 5; i++) {
    core.advance(31);
    const r = core.handle('POST', '/api/auth/otp/request', { phone }, { 'x-client-ip': '10.1.1.1' });
    assert.equal(r.status, 200, `request ${i + 1}`);
  }
  core.advance(31);
  const blocked = core.handle('POST', '/api/auth/otp/request', { phone }, { 'x-client-ip': '10.1.1.1' });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many OTP requests/);
  assert.ok(blocked.body.retry_after_sec > 0);
  // A different number from the same IP is still allowed (IP limit is 20).
  core.advance(31);
  assert.equal(core.handle('POST', '/api/auth/otp/request', { phone: '9123456702' }, { 'x-client-ip': '10.1.1.1' }).status, 200);
});

test('SOS creation is rate limited per user', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  let last;
  for (let i = 0; i < 6; i++) last = raj.raw('POST', '/api/sos', { lat: 19.1, lng: 72.8 });
  assert.equal(last.status, 429);
  assert.match(last.body.error, /112/);
});

test('request validation rejects bad profile and record input with a clear message', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  assert.throws(() => raj.put('/api/me', { dob: '12/03/1984' }), /dob must be YYYY-MM-DD/);
  assert.throws(() => raj.put('/api/me', { sex: 'X' }), /sex must be one of/);
  assert.throws(() => raj.post('/api/records', { title: 'x'.repeat(200) }), /at most 120/);
  assert.throws(() => raj.post('/api/records', { values: 'nope' }), /must be a list/);
  assert.equal(raj.put('/api/me', { city: 'Pune' }).user.city, 'Pune');
});

test('share-link tokens are unguessable random values, not sequential ids', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const rec = raj.get('/api/records/timeline').items[0];
  const a = raj.post(`/api/records/${rec.id}/share`, { minutes: 60 }).token;
  const b = raj.post(`/api/records/${rec.id}/share`, { minutes: 60 }).token;
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
  assert.ok(!a.startsWith('shr_'));
  assert.equal(core.handle('GET', `/api/shared/${a}`, null, {}).status, 200);
});
