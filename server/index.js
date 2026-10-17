'use strict';
// Aayuvridhi API server + static web app. Zero npm dependencies:
// node:http, node:crypto and node:sqlite (Node 22.5+).
//
//   npm start            → http://localhost:3000
//   DEMO_MODE=0 npm start → real random OTPs, no autopilot
//
// Settings can live in a .env file next to package.json (see .env.example).

const path0 = require('node:path');
const envFile = path0.join(__dirname, '..', '.env');
if (require('node:fs').existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCore } = require('../core/app');
const { seed } = require('../core/seed');
const { openDb } = require('./db-node');
const sms = require('./sms').fromEnv(process.env);
const { isDemoPhone } = require('../core/modules/identity');

const PORT = Number(process.env.PORT) || 3000;
const DEMO = process.env.DEMO_MODE !== '0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'aayuvridhi.db');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// Outside demo mode the server must have its own secret. It refuses to boot
// rather than silently signing tokens with a known or random key.
const DEMO_SECRET = 'demo-secret-change-me';
const SECRET = process.env.JWT_SECRET || (DEMO ? DEMO_SECRET : '');
if (!DEMO && (!SECRET || SECRET === DEMO_SECRET || SECRET.length < 32)) {
  console.error('Refusing to start: set JWT_SECRET to a random string of at least 32 characters (or DEMO_MODE=1 for the demo).');
  process.exit(1);
}
// Keyed hash for OTP and handover codes. Derived from the JWT secret, so a
// database leak alone does not reveal any code.
const KEYED = crypto.createHmac('sha256', SECRET).update('aayuvridhi:keyed-hash:v1').digest();
const keyedHmac = (message) => crypto.createHmac('sha256', KEYED).update(message).digest('hex');
const PUBLIC = path.join(__dirname, '..', 'public');
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

// ---- JWT (HS256) without dependencies ----
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(Object.assign({ exp: Date.now() + TOKEN_TTL_MS }, payload)));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = b64u(crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest());
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) {
    return null;
  }
}

let core;
let timer;
function boot(fresh) {
  if (core) core.c.db.close();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fresh) for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  core = createCore({
    db: openDb(DB_PATH),
    sign,
    verify,
    hmac: keyedHmac,
    demoMode: DEMO,
    demoOtp: DEMO ? '123456' : null,
    otpMode: sms ? sms.mode : null,
    autoConfirmSeconds: DEMO ? 8 : 0,
    maxDemoEtaMin: DEMO ? 2 : 0,
    log: (kind, msg) => console.log(`[${kind}] ${msg}`),
    onNotify: (uid, n, channels) => {
      if (channels.includes('sms') || channels.includes('call')) console.log(`[notify:${channels.join('+')}] ${uid}: ${n.title}`);
    },
  });
  if (seed(core)) console.log('Seeded demo data (Kumar family, Mumbai).');
  core.tick();
}
boot(false);
clearInterval(timer);
timer = setInterval(() => core.tick(), 5000);

// ---- real SMS OTP ----
async function deliverOtp(phone, code) {
  if (sms.mode === 'external') return sms.start(phone);
  if (!code) throw new Error('no OTP code to send');
  return sms.send(phone, code);
}

// Twilio Verify checks the code itself, so verification happens here
// (async) and core only issues the session once Twilio approves.
async function verifyExternal(body, ip) {
  const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
  const db = core.c.db;
  const gate = core.c.limiter.take(`otp-verify-external|phone:${phone}`, 10, 15 * 60000);
  if (!gate.ok) return { status: 429, body: { error: 'Too many attempts for this number. Try again in 15 minutes.', retry_after_sec: gate.retry_after_sec } };
  if (!core.c.limiter.take(`otp-verify-external|ip:${ip}`, 30, 10 * 60000).ok) return { status: 429, body: { error: 'Too many requests. Please wait and try again.' } };
  const row = db.get('SELECT * FROM otps WHERE phone = ?', [phone]);
  if (!row || row.mode !== 'external') return null; // demo numbers / other modes: core handles it
  if (row.expires_at <= new Date().toISOString()) return { status: 400, body: { error: 'OTP expired. Request a new one.' } };
  if (row.attempts >= 5) return { status: 429, body: { error: 'Too many wrong attempts. Try again in 15 minutes.' } };
  try {
    core.c.api.checkName(phone, body.name);
  } catch (e) {
    return { status: e.status || 400, body: { error: e.message } };
  }
  let ok;
  try {
    ok = await sms.check(phone, String(body.code || '').trim());
  } catch (e) {
    console.error(`[sms:${sms.name}] ${e.message}`);
    return { status: 502, body: { error: 'Could not check the OTP right now. Try again.' } };
  }
  if (!ok) {
    db.run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', [phone]);
    return { status: 400, body: { error: 'Incorrect OTP' } };
  }
  db.run('DELETE FROM otps WHERE phone = ?', [phone]);
  try {
    const session = core.c.api.issueSession(phone, body.name);
    core.c.events.drain();
    return { status: 200, body: session };
  } catch (e) {
    return { status: e.status || 500, body: { error: e.message } };
  }
}

// Security headers for the static app. style-src allows inline styles because
// the screens set style="" attributes; scripts are same-origin files only.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

// The client IP comes from the socket. X-Forwarded-For is trusted only when
// TRUST_PROXY=1 (behind a load balancer you control). Any x-client-ip header
// the client sends is overwritten here.
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function send(res, status, body, headers) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(data);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2e6) req.destroy();
    });
    req.on('end', async () => {
      const headers = Object.assign({}, req.headers, { 'x-client-ip': clientIp(req) });
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (e) {
          return send(res, 400, { error: 'Invalid JSON' });
        }
      }
      if (url === '/api/demo/reset' && req.method === 'POST') {
        if (!DEMO) return send(res, 403, { error: 'Demo mode is off' });
        boot(true);
        return send(res, 200, { ok: true });
      }
      if (url === '/api/health') return send(res, 200, { ok: true, demo: DEMO, sms: sms ? sms.name : 'none' });
      try {
        if (sms && req.method === 'POST' && url === '/api/auth/otp/verify') {
          const handled = await verifyExternal(body, headers['x-client-ip']);
          if (handled) return send(res, handled.status, handled.body);
        }
        const out = core.handle(req.method, url, body, headers);
        if (sms && req.method === 'POST' && url === '/api/auth/otp/request' && out.status === 200 && out.body.channel === 'sms') {
          const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
          try {
            await deliverOtp(phone, out.secret && out.secret.phone === phone ? out.secret.code : null);
            console.log(`[sms:${sms.name}] OTP sent to +91 ${phone.slice(0, 2)}xxxxxx${phone.slice(-2)}`);
          } catch (e) {
            core.c.db.run('DELETE FROM otps WHERE phone = ?', [phone]);
            console.error(`[sms:${sms.name}] ${e.message}`);
            return send(res, 502, { error: 'Could not send the OTP SMS. Check the SMS provider settings and try again.' });
          }
        }
        send(res, out.status, out.body);
      } catch (e) {
        console.error(e);
        send(res, 500, { error: 'Something went wrong' });
      }
    });
    return;
  }
  // Static web app (single-page, hash routing)
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.split('?')[0])));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SECURITY_HEADERS));
  fs.createReadStream(file).pipe(res);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\nAayuvridhi running → http://localhost:${PORT}`);
    if (DEMO) console.log('Demo mode: log in as 98765 00001 (Rajesh, Family Leader) or 98765 00003 (Kamla Devi), OTP 123456');
    console.log(sms ? `Real OTP SMS: ON via ${sms.name} (demo numbers 98765 000xx still use 123456)\n` : 'Real OTP SMS: OFF — set SMS_PROVIDER in .env to text OTPs to real phones\n');
  });
}

module.exports = { server, getCore: () => core, isDemoPhone };
