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

module.exports = { id, haversineKm, travelMinutes, iso, addMinutes, localDay, startOfDay, json, ageFrom, seasonFor, HttpError, must };
