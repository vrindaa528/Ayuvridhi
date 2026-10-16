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

function createCore(deps) {
  const db = deps.db;
  db.exec(schema);

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

  const router = createRouter();
  for (const m of MODULES) m.register(router, c);
  for (const m of MODULES) if (m.subscribe) m.subscribe(c);

  // Lets one module call another's internal API (e.g. wallet.charge).
  c.api = {};
  for (const m of MODULES) if (m.api) Object.assign(c.api, m.api(c));

  function authenticate(headers) {
    const h = headers.authorization || headers.Authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    const payload = deps.verify(token);
    if (!payload || !payload.sub) return null;
    const user = db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
    return user || null;
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
    try {
      let user = null;
      if (found.route.auth) {
        user = authenticate(headers);
        if (!user) return { status: 401, body: { error: 'Please log in' } };
      }
      const result = found.route.handler({ params: found.params, query, body: body || {}, user, headers });
      c.events.drain();
      return { status: 200, body: result === undefined ? { ok: true } : result };
    } catch (e) {
      c.events.drain();
      if (e instanceof util.HttpError) return { status: e.status, body: Object.assign({ error: e.message }, e.extra || {}) };
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

  return { handle, tick, c, routes: router.routes };
}

module.exports = { createCore };
