'use strict';
// createCore wires the database, event bus, consent engine and all domain
// modules into one request handler. The Node server and the in-browser
// prototype both call core.handle(); only the transport differs.

const schema = require('./schema');
const util = require('./util');
const { createRouter } = require('./router');
const { createEvents } = require('./events');
const { createConsent } = require('./consent');
const { createNotify } = require('./notify');
const { createRateLimiter } = require('./ratelimit');

const MODULES = [
  require('./modules/identity'),
  require('./modules/family'),
  require('./modules/serviceability'),
  require('./modules/booking'),
  require('./modules/consult'),
  require('./modules/pharmacy'),
  require('./modules/reminders'),
  require('./modules/wellness'),
  require('./modules/records'),
  require('./modules/wallet'),
  require('./modules/sos'),
  require('./modules/admin'),
];

// Columns added after the first release. CREATE TABLE IF NOT EXISTS does not
// alter existing tables, so older dev/demo databases are patched here.
// (Phase 6 replaces this with a real migrations folder.)
function ensureColumns(db) {
  const cols = (table) => db.all(`PRAGMA table_info(${table})`, []).map((r) => r.name);
  const add = (table, column, def) => {
    if (!cols(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  };
  add('users', 'role', "TEXT DEFAULT 'patient'");
  add('otps', 'code_hash', 'TEXT');
  add('otps', 'mode', "TEXT DEFAULT 'code'");
  add('access_logs', 'action', 'TEXT');
  add('access_logs', 'ip', 'TEXT');
  if (cols('orders').includes('otp_plain')) {
    // Plaintext delivery OTPs must not survive an upgrade.
    db.exec('UPDATE orders SET otp_plain = NULL');
    db.exec('ALTER TABLE orders DROP COLUMN otp_plain');
  }
}

function createCore(deps) {
  const db = deps.db;
  db.exec(schema);
  ensureColumns(db);
  if (typeof deps.hmac !== 'function') throw new Error('createCore: deps.hmac(message) is required (keyed hash for OTPs and handover codes)');

  const c = {
    db,
    now: deps.now || (() => new Date()),
    util,
    deps,
    log: deps.log || (() => {}),
  };
  c.events = createEvents(c);
  c.notify = createNotify(c);
  c.consent = createConsent(c);
  c.limiter = createRateLimiter(c.now);
  c.keyed = (message) => deps.hmac(message);

  // Staff access. A provider login acts only for the provider records it is
  // linked to in provider_accounts; admin routes check users.role directly.
  c.access = {
    providerIds(user) {
      return db.all('SELECT provider_id FROM provider_accounts WHERE user_id = ?', [user.id]).map((r) => r.provider_id);
    },
    assertOwns(user, providerId) {
      if (!providerId || !this.providerIds(user).includes(providerId)) {
        throw new util.HttpError(403, 'This account cannot act for that provider');
      }
    },
  };

  // Audit trail for everything staff do to patients or providers.
  c.audit = (actor, action, target, ip, detail) => {
    db.run('INSERT INTO access_logs (actor_id, patient_id, category, purpose, at, action, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      actor ? actor.id : null,
      target || null,
      'audit',
      detail || action,
      c.now().toISOString(),
      action,
      ip || null,
    ]);
  };

  const router = createRouter();
  for (const m of MODULES) m.register(router, c);
  c.router = router;
  for (const m of MODULES) if (m.subscribe) m.subscribe(c);

  // Lets one module call another's internal API (e.g. wallet.charge).
  c.api = {};
  for (const m of MODULES) if (m.api) Object.assign(c.api, m.api(c));

  // The token only proves who the user is. Role is always read from the
  // database, so a demoted or suspended account loses access immediately.
  function authenticate(headers) {
    const h = headers.authorization || headers.Authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    const payload = deps.verify(token);
    if (!payload || !payload.sub) return null;
    const user = db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
    return user || null;
  }

  function clientIp(headers) {
    return String(headers['x-client-ip'] || 'unknown');
  }

  // Applies a route's rate limits. Returns an error result or null.
  function throttle(route, body, user, ip) {
    for (const rule of route.rate || []) {
      let key;
      if (rule.by === 'ip') key = `ip:${ip}`;
      else if (rule.by === 'phone') {
        const phone = String((body && body.phone) || '').replace(/\D/g, '').slice(-10);
        if (!phone) continue;
        key = `phone:${phone}`;
      } else if (rule.by === 'user') {
        if (!user) continue;
        key = `user:${user.id}`;
      } else continue;
      const r = c.limiter.take(`${rule.name}|${key}`, rule.limit, rule.windowMs);
      if (!r.ok) {
        return { status: 429, body: { error: rule.message || 'Too many requests. Please wait and try again.', retry_after_sec: r.retry_after_sec } };
      }
    }
    return null;
  }

  function handle(method, url, body, headers) {
    headers = headers || {};
    const [path, qs] = url.split('?');
    const query = {};
    if (qs) {
      for (const part of qs.split('&')) {
        if (!part) continue;
        const [k, v = ''] = part.split('=');
        query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
      }
    }
    const found = router.match(method, path);
    if (!found) return { status: 404, body: { error: 'Not found' } };
    let user = null;
    try {
      if (found.route.auth) {
        user = authenticate(headers);
        if (!user) return { status: 401, body: { error: 'Please log in' } };
      }
      if (found.route.roles && !found.route.roles.includes(user.role || 'patient')) {
        c.audit(user, 'access_denied', null, clientIp(headers), `${method} ${path} (role ${user.role || 'patient'})`);
        return { status: 403, body: { error: 'Your account does not have access to this' } };
      }
      const limited = throttle(found.route, body, user, clientIp(headers));
      if (limited) return limited;
      const result = found.route.handler({ params: found.params, query, body: body || {}, user, headers, ip: clientIp(headers) });
      c.events.drain();
      // A handler may return { __body, __secret }: __secret goes only to the
      // host (e.g. to text an OTP) and is never part of the response.
      if (result && typeof result === 'object' && '__body' in result) {
        return { status: 200, body: result.__body, secret: result.__secret || null };
      }
      return { status: 200, body: result === undefined ? { ok: true } : result };
    } catch (e) {
      c.events.drain();
      if (e instanceof util.HttpError) {
        // Every refusal is recorded: who tried what, from where.
        if (e.status === 403 && user) c.audit(user, 'access_denied', null, clientIp(headers), `${method} ${path}`);
        return { status: e.status, body: Object.assign({ error: e.message }, e.extra || {}) };
      }
      c.log('error', e && e.stack ? e.stack : String(e));
      return { status: 500, body: { error: 'Something went wrong' } };
    }
  }

  // Background work: reminders, missed-dose escalation, slot-hold expiry,
  // delivery progress, SOS ambulance arrival. Called every 30 s by the host.
  function tick() {
    for (const m of MODULES) if (m.tick) m.tick(c);
    c.events.drain();
  }

  return { handle, tick, c, routes: router.routes, clientIp };
}

module.exports = { createCore };
