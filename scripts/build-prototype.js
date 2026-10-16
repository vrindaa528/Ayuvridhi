'use strict';
// Builds dist/aayuvridhi-prototype.html: the web app plus the *same* backend
// core running in the browser on SQLite (sql.js, asm.js build — no WASM, no
// server). Used for the hosted click-through demo.
//
//   npm install --no-save sql.js@1.13.0 && npm run build:prototype

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function findSqlJs() {
  const candidates = [
    process.env.SQLJS_DIST,
    path.join(ROOT, 'node_modules', 'sql.js', 'dist'),
  ].filter(Boolean);
  for (const c of candidates) {
    const f = path.join(c, 'sql-asm-memory-growth.js');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  throw new Error('sql.js not found. Run: npm install --no-save sql.js@1.13.0 (or set SQLJS_DIST)');
}

// ---- bundle core/ as tiny CommonJS modules ----
function collect(dir, base, out) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = path.posix.join(dir, f);
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) collect(rel, base, out);
    else if (f.endsWith('.js')) out[rel] = read(rel);
  }
  return out;
}
const modules = collect('core', 'core', {});
const defs = Object.entries(modules)
  .map(([name, src]) => `${JSON.stringify(name)}: function (module, exports, require) {\n${src}\n}`)
  .join(',\n');

const runtime = `
(function () {
  'use strict';
  var defs = {${defs}};
  var cache = {};
  function resolve(from, req) {
    var parts = from.split('/'); parts.pop();
    req.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    var id = parts.join('/');
    return defs[id + '.js'] ? id + '.js' : id;
  }
  function load(id) {
    if (cache[id]) return cache[id].exports;
    if (!defs[id]) throw new Error('module not found: ' + id);
    var m = { exports: {} };
    cache[id] = m;
    defs[id](m, m.exports, function (r) { return load(resolve(id, r)); });
    return m.exports;
  }
  var createCore = load('core/app.js').createCore;
  var seed = load('core/seed.js').seed;

  function clean(params) { return (params || []).map(function (p) { return p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p; }); }
  function adapter(db) {
    return {
      exec: function (sql) { db.exec(sql); },
      all: function (sql, params) { var s = db.prepare(sql); s.bind(clean(params)); var rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
      get: function (sql, params) { var s = db.prepare(sql); s.bind(clean(params)); var row = s.step() ? s.getAsObject() : undefined; s.free(); return row; },
      run: function (sql, params) { db.run(sql, clean(params)); },
      close: function () { db.close(); },
    };
  }
  function hash(str) { // cyrb53 — fine for a demo OTP hash
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  var b64 = function (s) { return btoa(unescape(encodeURIComponent(s))); };
  var unb64 = function (s) { return decodeURIComponent(escape(atob(s))); };

  // Persist the demo database per viewer in IndexedDB (best effort).
  var IDB = 'aayuvridhi-demo', KEY = 'db-v1';
  function idb(mode, fn) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open(IDB, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { try { var tx = rq.result.transaction('kv', mode); var r = fn(tx.objectStore('kv')); tx.oncomplete = function () { res(r && r.result); }; tx.onerror = function () { res(null); }; } catch (e) { res(null); } };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  var SQL, raw, core, saveTimer;
  function boot(bytes) {
    raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
    core = createCore({
      db: adapter(raw),
      sign: function (p) { return b64(JSON.stringify(p)); },
      verify: function (t) { try { return JSON.parse(unb64(t)); } catch (e) { return null; } },
      hash: hash,
      demoOtp: '123456',
      autoConfirmSeconds: 8,
      maxDemoEtaMin: 2,
      log: function () {},
    });
    if (!bytes) seed(core);
    core.tick();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { try { var data = raw.export(); idb('readwrite', function (s) { return s.put(data, KEY); }); } catch (e) { /* ignore */ } }, 800);
  }
  window.AY_READY = initSqlJs().then(function (S) {
    SQL = S;
    return idb('readonly', function (s) { return s.get(KEY); });
  }).then(function (bytes) {
    try { boot(bytes || null); } catch (e) { boot(null); }
    setInterval(function () { try { core.tick(); save(); } catch (e) { /* ignore */ } }, 5000);
  });
  window.AY_TRANSPORT = function (method, url, body, headers) {
    return window.AY_READY.then(function () {
      var out = core.handle(method, url, body ? JSON.parse(JSON.stringify(body)) : {}, headers || {});
      if (method !== 'GET') save();
      return { status: out.status, body: JSON.parse(JSON.stringify(out.body)) };
    });
  };
  window.AY_RESET = function () {
    return window.AY_READY.then(function () {
      try { raw.close(); } catch (e) { /* ignore */ }
      boot(null);
      return idb('readwrite', function (s) { return s.delete(KEY); }).then(function () { return { ok: true }; });
    });
  };
})();
`;

// ---- assemble the page ----
const html = read('public/index.html');
const app = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->'));
const css = read('public/styles.css');
const scripts = ['lib', 'screens-home', 'screens-care', 'screens-pharmacy', 'screens-family', 'screens-records', 'screens-more', 'main'].map((n) => read(`public/js/${n}.js`));
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

const out = `<meta charset="utf-8">
<title>Aayuvridhi</title>
<style>
${css}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
${app}
<script>
${guard(findSqlJs())}
</script>
<script>
${guard(runtime)}
</script>
${scripts.map((s) => `<script>\n${guard(s)}\n</script>`).join('\n')}
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist', 'aayuvridhi-prototype.html');
fs.writeFileSync(file, out);
console.log(`Wrote ${path.relative(ROOT, file)} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
