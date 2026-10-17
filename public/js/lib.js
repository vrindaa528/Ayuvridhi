/* Aayuvridhi web app — shared helpers, API client, router, components.
   Plain scripts, no build step. AY_TRANSPORT (set by the standalone
   prototype build) replaces fetch with an in-browser copy of the backend. */
'use strict';

const store = {
  get(k, d) { try { const v = localStorage.getItem('ay.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ay.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('ay.' + k); } catch (e) { /* ignore */ } },
};

const S = { token: store.get('token', null), me: null, family: null, member: null, unread: 0, roleTokens: {}, consoleRole: 'doctor' };

// Staff screens (/api/provider, /api/admin) act with a staff login. In the demo
// the Partner console signs in as a seeded staff user with /api/demo/partner-token.
// In production each staff role signs in with its own OTP (see Phase 5).
function roleFor(path) {
  if (path.startsWith('/api/admin/')) return 'ops';
  if (path.startsWith('/api/provider/')) return S.consoleRole || 'doctor';
  return null;
}

async function rawCall(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (window.AY_TRANSPORT) {
    const out = await window.AY_TRANSPORT(method, path, body, headers);
    return { status: out.status, data: out.body };
  }
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function staffToken(role) {
  if (S.roleTokens[role]) return S.roleTokens[role];
  const out = await rawCall('POST', '/api/demo/partner-token', { role }, null);
  if (out.status >= 400) { const e = new Error(out.data.error || 'Staff sign-in is not available'); e.status = out.status; throw e; }
  S.roleTokens[role] = out.data.token;
  return S.roleTokens[role];
}

async function api(method, path, body) {
  const role = roleFor(path);
  let token = S.token;
  if (role) {
    token = await staffToken(role);
  }
  let out = await rawCall(method, path, body, token);
  if (role && out.status === 401) { delete S.roleTokens[role]; token = await staffToken(role); out = await rawCall(method, path, body, token); }
  const status = out.status; const data = out.data;
  if (status === 401 && !role && !path.startsWith('/api/auth')) { logout(); throw new Error('Please log in again'); }
  if (status >= 400) { const e = new Error(data.error || 'Something went wrong'); e.status = status; e.data = data; throw e; }
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b || {});
const PUT = (p, b) => api('PUT', p, b || {});

function logout() {
  S.token = null; S.me = null; S.member = null;
  store.del('token'); store.del('member');
  go('#/login');
}

/* ---------- formatting ---------- */
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const tm = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const dt = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dshort = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
function dayLabel(iso) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return dshort(iso);
}
const initials = (name) => String(name || '?').replace(/^Dr\.\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avClass = (id) => 'c' + ((String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 4) + 1);
const first = (name) => String(name || '').split(' ')[0];
const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------- icons (24px stroke) ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  care: '<path d="M12 21s-7-4.4-7-10.2A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7 2.8C19 16.6 12 21 12 21z"/><path d="M12 11v5M9.5 13.5h5"/>',
  family: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.6-3.5 2.8-5.5 5.5-5.5s4.9 2 5.5 5.5"/><path d="M14 15.2c.9-.5 1.9-.7 3-.7 2.3 0 4 1.6 4.5 4.5"/>',
  records: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M16 15h2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>',
  pill: '<rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M9.3 8.2l5.6 8"/>',
  doctor: '<circle cx="12" cy="7" r="4"/><path d="M5 21c.8-4 3.5-6 7-6s6.2 2 7 6"/><path d="M12 15v3M10.5 16.5h3"/>',
  lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 14h9"/>',
  hospital: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M12 8v6M9 11h6"/><path d="M9 21v-3h6v3"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19 13 11"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h7"/><circle cx="16.5" cy="11" r="2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M10 21l2-6-2-3 1-5 4 3 3 1M8 11l2-4M14 15l2 6"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  breath: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  cart: '<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  console: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 9l3 2-3 2M12 13h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  logout: '<path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const ic = (name, cls) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[name] || P.info}</svg>`;
const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="none" stroke="var(--brand)" stroke-width="2.4"/><path d="M24 39c-9-5-13-11-13-17 6 0 10 3 13 8 3-5 7-8 13-8 0 6-4 12-13 17z" fill="var(--brand)"/><path d="M24 30c-3-4-3-9 0-14 3 5 3 10 0 14z" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="1.6"/><path d="M19.5 15.5a2.3 2.3 0 0 1 4.5-.6 2.3 2.3 0 0 1 4.5.6c0 2.2-4.5 4.6-4.5 4.6s-4.5-2.4-4.5-4.6z" fill="var(--saffron)"/></svg>';

/* ---------- UI helpers ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function on(root, sel, ev, fn) {
  root.addEventListener(ev, (e) => {
    const t = e.target.closest(sel);
    if (t && root.contains(t)) fn(e, t);
  });
}
let toastTimer;
function toast(msg, bad) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}
async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    throw e;
  } finally {
    if (btn && document.body.contains(btn)) btn.disabled = false;
  }
}
function sheet(html, mount) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(bg);
  if (mount) mount(bg.querySelector('.sheet'), close);
  return close;
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select the text to copy it', true); }
    ta.remove();
  }
}

/* ---------- small components ---------- */
const statusPill = {
  taken: '<span class="pill ok">' + ic('check') + 'Taken</span>',
  missed: '<span class="pill bad">Missed</span>',
  due: '<span class="pill warn">Due now</span>',
  snoozed: '<span class="pill warn">Snoozed</span>',
  skipped: '<span class="pill">Skipped</span>',
  upcoming: '<span class="pill brand">Upcoming</span>',
};
const bookingPill = (s) => {
  const map = { requested: 'warn', confirmed: 'ok', checked_in: 'info', in_consult: 'info', completed: 'brand', cancelled_by_patient: '', cancelled_by_provider: 'bad', no_show: 'bad' };
  const label = { requested: 'Awaiting confirmation', confirmed: 'Confirmed', checked_in: 'Checked in', in_consult: 'In consult', completed: 'Completed', cancelled_by_patient: 'Cancelled', cancelled_by_provider: 'Cancelled by clinic', no_show: 'Missed' };
  return `<span class="pill ${map[s] || ''}">${label[s] || cap(s)}</span>`;
};
const orderPill = (s) => {
  const map = { placed: 'warn', substitution_pending: 'warn', verified: 'info', dispatched: 'info', arrived: 'ok', delivered: 'ok', completed: 'brand', cancelled: '' };
  const label = { placed: 'Awaiting pharmacist', substitution_pending: 'Needs your approval', verified: 'Verified · packing', dispatched: 'Out for delivery', arrived: 'At your door', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' };
  return `<span class="pill ${map[s] || ''}">${label[s] || cap(s)}</span>`;
};
const servPill = (s) => `<span class="pill ${s === 'Available' ? 'ok' : s === 'Limited' ? 'warn' : 'bad'}">${s === 'Available' ? 'Available today' : s === 'Limited' ? 'Next slot later' : 'Unavailable'}</span>`;
const freshPill = (p) => (p.freshness === 'live' ? `<span class="pill brand" title="Availability synced ${p.updated_min_ago} min ago">● Live</span>` : `<span class="pill warn" title="Provider has not updated availability recently">Availability unconfirmed</span>`);
const verifiedTag = () => `<span class="verified">${ic('shield')}Verified</span>`;
const typeIcon = { prescription: 'pill', lab_report: 'lab', consultation: 'doctor', vaccination: 'shield', discharge: 'hospital', imaging: 'eye', medicine: 'truck', emergency: 'alert', document: 'records', milestone: 'spark' };
const typeLabel = { prescription: 'Prescription', lab_report: 'Lab report', consultation: 'Consultation', vaccination: 'Vaccination', discharge: 'Discharge summary', imaging: 'Imaging', medicine: 'Medicines', emergency: 'Emergency', document: 'Document', milestone: 'Milestone' };
const catLabel = { consult: 'Consultations', lab: 'Lab tests', pharmacy: 'Medicines', subscription: 'Plans' };

function ring(done, total, missed) {
  const r = 18, C = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const col = missed ? 'var(--danger)' : 'var(--ok)';
  return `<svg class="ring" viewBox="0 0 46 46" aria-label="${done} of ${total} doses taken"><circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="23" cy="23" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C * pct} ${C}" transform="rotate(-90 23 23)"/><text class="t" x="23" y="27" text-anchor="middle">${done}/${total}</text></svg>`;
}

function spark(points, refMax) {
  if (!points || points.length < 2) return '';
  const W = 280, H = 64, pad = 8;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (refMax !== null && refMax !== undefined) { lo = Math.min(lo, refMax); hi = Math.max(hi, refMax); }
  const span = hi - lo || 1;
  const x = (i) => pad + (i / (points.length - 1)) * (W - pad * 2 - 34);
  const y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${x(points.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const last = points[points.length - 1];
  const ref = refMax !== null && refMax !== undefined ? `<line x1="${pad}" x2="${W - pad - 34}" y1="${y(refMax)}" y2="${y(refMax)}" stroke="var(--ok)" stroke-dasharray="3 4" stroke-width="1.2"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Trend ending at ${last.value}">${ref}<path d="${area}" fill="var(--brand)" fill-opacity="0.1"/><path d="${d}" fill="none" stroke="var(--brand)" stroke-width="2"/><circle cx="${x(points.length - 1)}" cy="${y(last.value)}" r="4" fill="var(--brand)"/><text x="${W - 4}" y="${y(last.value) + 4}" text-anchor="end" font-size="12" font-weight="700" fill="var(--ink)">${last.value}</text></svg>`;
}

/* ---------- router ---------- */
const routes = [];
function route(pattern, title, fn, opts) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/?]+)'; }) + '$');
  routes.push({ re, keys, title, fn, opts: opts || {} });
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
let timers = [];
function poll(fn, ms) { const id = setInterval(fn, ms); timers.push(id); }
function clearTimers() { timers.forEach(clearInterval); timers = []; }
function qs() {
  const q = {};
  const raw = (location.hash.split('?')[1] || '');
  raw.split('&').filter(Boolean).forEach((p) => { const [k, v] = p.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return q;
}

let renderSeq = 0;
async function render() {
  clearTimers();
  const seq = ++renderSeq;
  const hash = location.hash || '#/home';
  const path = hash.slice(1).split('?')[0] || '/home';
  if (!S.token && path !== '/login') return go('#/login');
  if (S.token && path === '/login') return go('#/home');
  let found = null, params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { found = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
  }
  if (!found) return go('#/home');
  const shell = !found.opts.bare;
  $('#topbar').hidden = !shell;
  $('#tabbar').hidden = !shell;
  const view = $('#view');
  if (shell) await ensureMe();
  if (seq !== renderSeq) return;
  setTop(found, params);
  $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (found.opts.tab || '')));
  view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  try {
    await found.fn(fresh, params, qs());
  } catch (e) {
    if (seq !== renderSeq) return;
    fresh.innerHTML = `<div class="card alert"><strong>Couldn’t load this screen</strong><p class="small">${esc(e.message)}</p><div><button class="btn sm" onclick="render()">Try again</button></div></div>`;
  }
  if (seq === renderSeq) window.scrollTo(0, 0);
}

function setTop(r, params) {
  const top = $('#topbar');
  const isRoot = !!r.opts.tab && r.opts.root;
  const titleText = typeof r.title === 'function' ? r.title(params) : r.title;
  top.innerHTML = `
    ${isRoot ? `<a class="brandmark" href="#/home" aria-label="Aayuvridhi home">${LOGO}<span>Aayuvridhi</span></a><span class="grow"></span>`
      : `<button class="iconbtn" aria-label="Back" onclick="history.length > 1 ? history.back() : go('#/home')">${ic('back')}</button><div class="title">${esc(titleText)}</div>`}
    <a class="iconbtn" href="#/notifications" aria-label="Notifications">${ic('bell')}${S.unread ? '<span class="dot"></span>' : ''}</a>
    <a class="iconbtn" href="#/profile" aria-label="Profile">${ic('user')}</a>
    <button class="sos-btn" onclick="go('#/sos')" aria-label="Emergency SOS">SOS</button>`;
}

async function ensureMe(force) {
  if (S.me && !force) return;
  const me = await GET('/api/me');
  S.me = me.user; S.unread = me.unread; S.familyInfo = me.family;
  try {
    const f = await GET('/api/family');
    S.family = f;
  } catch (e) { S.family = null; }
}
function viewableMembers(category) {
  const out = [{ id: S.me.id, name: S.me.name, relation: 'You' }];
  if (S.family && S.family.members) {
    for (const m of S.family.members) {
      if (m.is_me) continue;
      if ((m.access || []).includes(category)) out.push({ id: m.id, name: m.name, relation: m.relation });
    }
  }
  return out;
}
function memberChips(category, current, cls) {
  const list = viewableMembers(category);
  if (list.length < 2) return '';
  return `<div class="chips ${cls || ''}" role="tablist" aria-label="Family member">${list
    .map((m) => `<button class="chip ${m.id === current ? 'on' : ''}" data-member="${m.id}" role="tab" aria-selected="${m.id === current}"><span class="av ${avClass(m.id)}">${initials(m.name)}</span>${esc(m.id === S.me.id ? 'Me' : first(m.name))}</button>`)
    .join('')}</div>`;
}
function memberSelect(category, id, current) {
  const list = viewableMembers(category);
  return `<select class="input" id="${id}">${list.map((m) => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${esc(m.id === S.me.id ? `${m.name} (you)` : `${m.name} · ${m.relation}`)}</option>`).join('')}</select>`;
}
