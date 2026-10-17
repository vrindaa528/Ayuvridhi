'use strict';
// Small helpers shared by every module. No Node or browser APIs here, so the
// same file runs on the server and inside the in-browser prototype.

let counter = 0;
function id(prefix) {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// City travel estimate: ~22 km/h average in Indian metro traffic + 4 min overhead.
function travelMinutes(km) {
  return Math.round(4 + (km / 22) * 60);
}

function iso(d) {
  return new Date(d).toISOString();
}

function addMinutes(d, m) {
  return new Date(new Date(d).getTime() + m * 60000);
}

function localDay(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function json(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  try {
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function ageFrom(dob, now) {
  const b = new Date(dob);
  const n = new Date(now);
  let a = n.getFullYear() - b.getFullYear();
  const md = n.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && n.getDate() < b.getDate())) a--;
  return a;
}

// Indian seasons (ritu) used by Dadi Ke Nuskhe for seasonal advice.
function seasonFor(d) {
  const m = new Date(d).getMonth() + 1;
  if (m === 3 || m === 4 || m === 5) return 'summer';
  if (m >= 6 && m <= 9) return 'monsoon';
  if (m === 10 || m === 11) return 'autumn';
  return 'winter';
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function must(cond, status, message) {
  if (!cond) throw new HttpError(status, message);
}

// Unguessable tokens (share links, invites). Uses the platform CSPRNG, which
// exists in Node 19+ and every modern browser. Never use id() for secrets.
function secureToken(bytes) {
  const n = bytes || 24;
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}

// Constant-time string comparison for hashes and codes.
function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Request validation. spec: { field: { type, max, min, required, enum, pattern } }
// type: 'string' | 'number' | 'boolean' | 'array' | 'object'. Throws 400 with the
// first problem found, so the client gets one clear message.
function validate(body, spec) {
  const b = body || {};
  for (const [field, rule] of Object.entries(spec)) {
    const v = b[field];
    const missing = v === undefined || v === null || v === '';
    if (missing) {
      must(!rule.required, 400, `${field} is required`);
      continue;
    }
    const t = rule.type || 'string';
    if (t === 'array') must(Array.isArray(v), 400, `${field} must be a list`);
    else if (t === 'object') must(typeof v === 'object' && !Array.isArray(v), 400, `${field} must be an object`);
    else if (t === 'number') must(typeof v === 'number' && Number.isFinite(v), 400, `${field} must be a number`);
    else if (t === 'boolean') must(typeof v === 'boolean', 400, `${field} must be true or false`);
    else must(typeof v === 'string', 400, `${field} must be text`);
    if (t === 'number') {
      if (rule.min !== undefined) must(v >= rule.min, 400, `${field} must be at least ${rule.min}`);
      if (rule.max !== undefined) must(v <= rule.max, 400, `${field} must be at most ${rule.max}`);
    } else if (t === 'string') {
      if (rule.min !== undefined) must(v.trim().length >= rule.min, 400, `${field} must be at least ${rule.min} characters`);
      if (rule.max !== undefined) must(v.length <= rule.max, 400, `${field} must be at most ${rule.max} characters`);
      if (rule.pattern) must(rule.pattern.test(v), 400, rule.message || `${field} has an invalid format`);
      if (rule.enum) must(rule.enum.includes(v), 400, `${field} must be one of: ${rule.enum.join(', ')}`);
    } else if (t === 'array') {
      if (rule.max !== undefined) must(v.length <= rule.max, 400, `${field} can have at most ${rule.max} items`);
    }
  }
  return b;
}

module.exports = { id, haversineKm, travelMinutes, iso, addMinutes, localDay, startOfDay, json, ageFrom, seasonFor, HttpError, must, secureToken, safeEqual, validate };
