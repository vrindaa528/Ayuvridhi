'use strict';
// Process-level checks: the server refuses an unsafe boot, sends security
// headers, and refuses demo sign-in outside demo mode.

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const entry = path.join(ROOT, 'server', 'index.js');

function run(env, ms) {
  const port = 3800 + Math.floor(Math.random() * 300);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ay-srv-'));
  const child = spawn(process.execPath, ['--no-warnings', entry], {
    env: Object.assign({}, process.env, { PORT: String(port), DB_PATH: path.join(dir, 'x.db') }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return { child, port, log: () => log, exited: new Promise((r) => child.on('exit', (code) => r(code))), ms };
}

test('without DEMO_MODE, the server refuses to start without a real JWT_SECRET', async () => {
  const a = run({ DEMO_MODE: '0', JWT_SECRET: '' });
  const code = await a.exited;
  assert.equal(code, 1);
  assert.match(a.log(), /Refusing to start/);
  const b = run({ DEMO_MODE: '0', JWT_SECRET: 'demo-secret-change-me' });
  assert.equal(await b.exited, 1, 'the demo secret is not accepted outside demo mode');
  const c = run({ DEMO_MODE: '0', JWT_SECRET: 'short' });
  assert.equal(await c.exited, 1, 'short secrets are refused');
});

test('demo sign-in is refused when DEMO_MODE is off, even with a strong secret', async () => {
  const secret = 'x'.repeat(40);
  const app = run({ DEMO_MODE: '0', JWT_SECRET: secret });
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/demo/partner-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'ops' }) });
    assert.equal(res.status, 403);
    const otp = await fetch(`http://127.0.0.1:${app.port}/api/auth/otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876500099' }) });
    assert.equal(otp.status, 200);
    assert.ok(!(await otp.text()).includes('123456'), 'no fixed demo code outside demo mode');
  } finally {
    app.child.kill();
  }
});

test('static pages carry CSP, frame and referrer headers', async () => {
  const app = run({});
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/, 'scripts only from this origin');
  } finally {
    app.child.kill();
  }
});
