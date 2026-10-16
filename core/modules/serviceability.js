'use strict';
// serviceability: provider search with live slots, distance, ETA, wait time,
// upfront price and a freshness score. Only Trust-Layer-verified providers appear.

const { must, json, haversineKm, travelMinutes, addMinutes, startOfDay, localDay } = require('../util');

const STALE_MIN = 15;

function register(r, c) {
  const { db } = c;

  function origin(user, query) {
    const lat = query.lat ? Number(query.lat) : user.lat;
    const lng = query.lng ? Number(query.lng) : user.lng;
    return { lat: lat || 19.076, lng: lng || 72.8777 };
  }

  r.get('/api/providers', ({ user, query }) => {
    const o = origin(user, query);
    const where = ["verified_status = 'verified'"];
    const args = [];
    if (query.type) {
      const types = query.type.split(',');
      where.push(`type IN (${types.map(() => '?').join(',')})`);
      args.push(...types);
    }
    if (query.specialty) {
      where.push('specialty = ?');
      args.push(query.specialty);
    } else {
      where.push("COALESCE(specialty, '') != 'Emergency Medicine'");
    }
    if (query.q) {
      where.push('(name LIKE ? OR specialty LIKE ? OR services LIKE ?)');
      args.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
    }
    if (query.er === '1') where.push('has_er = 1');
    if (query.home === '1') where.push('home_collection = 1');
    let rows = db.all(`SELECT * FROM providers WHERE ${where.join(' AND ')}`, args).map((p) => card(p, o));
    const maxKm = query.radius ? Number(query.radius) : 25;
    rows = rows.filter((p) => p.distance_km <= maxKm);
    const sort = query.sort || 'next';
    rows.sort((a, b) => {
      if (sort === 'distance') return a.distance_km - b.distance_km;
      if (sort === 'price') return (a.fee || 0) - (b.fee || 0);
      const sa = a.serviceability === 'Available' ? 0 : a.serviceability === 'Limited' ? 1 : 2;
      const sb = b.serviceability === 'Available' ? 0 : b.serviceability === 'Limited' ? 1 : 2;
      if (sa !== sb) return sa - sb;
      if (a.freshness !== b.freshness) return a.freshness === 'live' ? -1 : 1;
      return (a.next_slot || 'z').localeCompare(b.next_slot || 'z') || a.distance_km - b.distance_km;
    });
    return { items: rows, origin: o };
  });

  r.get('/api/specialties', () => {
    return { items: db.all("SELECT DISTINCT specialty FROM providers WHERE type = 'doctor' AND verified_status = 'verified' ORDER BY specialty", []).map((x) => x.specialty) };
  });

  r.get('/api/providers/:id', ({ user, params, query }) => {
    const p = db.get('SELECT * FROM providers WHERE id = ?', [params.id]);
    must(p, 404, 'Provider not found');
    const checks = db.all('SELECT check_name, result, at FROM verifications WHERE provider_id = ? ORDER BY id', [p.id]);
    return Object.assign(card(p, origin(user, query)), { checks, address: p.address, languages: json(p.languages, []), accreditation: p.accreditation });
  });

  r.get('/api/providers/:id/slots', ({ params, query }) => {
    const p = db.get('SELECT * FROM providers WHERE id = ?', [params.id]);
    must(p, 404, 'Provider not found');
    const day = query.date ? new Date(`${query.date}T00:00:00`) : c.now();
    c.api.ensureSlots(p, day);
    const from = startOfDay(day).toISOString();
    const to = addMinutes(startOfDay(day), 24 * 60).toISOString();
    const now = c.now().toISOString();
    const slots = db.all('SELECT * FROM slots WHERE provider_id = ? AND start_at >= ? AND start_at < ? ORDER BY start_at', [p.id, from, to]);
    return {
      date: localDay(day),
      items: slots
        .filter((s) => s.start_at > now)
        .map((s) => ({
          id: s.id,
          start_at: s.start_at,
          price: s.price,
          mode: s.mode,
          status: s.status === 'held' && s.hold_expires_at < now ? 'open' : s.status,
        })),
    };
  });

  function card(p, o) {
    const km = Math.round(haversineKm(o.lat, o.lng, p.lat, p.lng) * 10) / 10;
    const now = c.now();
    let next = null;
    if (['doctor', 'lab', 'clinic', 'hospital'].includes(p.type)) {
      c.api.ensureSlots(p, now);
      c.api.ensureSlots(p, addMinutes(now, 24 * 60));
      const s = db.get(
        "SELECT start_at FROM slots WHERE provider_id = ? AND start_at > ? AND (status = 'open' OR (status = 'held' AND hold_expires_at < ?)) ORDER BY start_at LIMIT 1",
        [p.id, now.toISOString(), now.toISOString()]
      );
      next = s ? s.start_at : null;
    }
    const ageMin = p.availability_updated_at ? (now - new Date(p.availability_updated_at)) / 60000 : 999;
    const freshness = ageMin <= STALE_MIN ? 'live' : 'unconfirmed';
    let status = 'Available';
    if (!p.is_open) status = 'Unavailable';
    else if (['doctor', 'lab', 'clinic', 'hospital'].includes(p.type)) {
      if (!next) status = 'Unavailable';
      else if (localDay(next) !== localDay(now)) status = 'Limited';
    }
    const waitLo = Math.max(5, p.avg_wait_min + p.queue_len * 3 - 5);
    return {
      id: p.id,
      type: p.type,
      name: p.name,
      specialty: p.specialty,
      qualification: p.qualification,
      reg_no: p.reg_no,
      rating: p.rating,
      fee: p.fee,
      verified: p.verified_status === 'verified',
      accreditation: p.accreditation,
      has_er: !!p.has_er,
      home_collection: !!p.home_collection,
      services: json(p.services, []),
      distance_km: km,
      travel_min: travelMinutes(km),
      wait_min: [waitLo, waitLo + 10],
      next_slot: next,
      serviceability: status,
      freshness,
      updated_min_ago: Math.round(ageMin),
      lat: p.lat,
      lng: p.lng,
    };
  }

  r.card = card;
}

// Deterministic pseudo-random so seeded "already booked" slots look real but
// stay the same across restarts.
function hashInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function api(c) {
  const { db } = c;
  return {
    ensureSlots(p, day) {
      if (!['doctor', 'lab', 'clinic', 'hospital'].includes(p.type)) return;
      const d0 = startOfDay(day);
      const from = d0.toISOString();
      const to = addMinutes(d0, 24 * 60).toISOString();
      const have = db.get('SELECT COUNT(*) AS n FROM slots WHERE provider_id = ? AND start_at >= ? AND start_at < ?', [p.id, from, to]).n;
      if (have) return;
      const isLab = p.type === 'lab';
      const startH = isLab ? 7 : 9;
      const endH = isLab ? 13 : 20;
      const step = isLab ? 30 : p.type === 'doctor' ? 20 : 30;
      for (let m = startH * 60; m < endH * 60; m += step) {
        if (!isLab && m >= 13 * 60 && m < 14 * 60) continue; // lunch
        const start = addMinutes(d0, m);
        const key = `${p.id}${localDay(d0)}${m}`;
        const booked = hashInt(key) % 10 < 4; // ~40% already taken
        db.run('INSERT INTO slots (id, provider_id, start_at, end_at, status, price, mode) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          `slt_${p.id}_${localDay(d0)}_${m}`,
          p.id,
          start.toISOString(),
          addMinutes(start, step).toISOString(),
          booked ? 'booked' : 'open',
          p.fee,
          p.type === 'doctor' ? 'video,clinic' : isLab ? 'home,centre' : 'clinic',
        ]);
      }
    },
    providerCard(p, o) {
      // re-use the register-time card builder without the router
      const km = Math.round(haversineKm(o.lat, o.lng, p.lat, p.lng) * 10) / 10;
      return { id: p.id, name: p.name, type: p.type, distance_km: km, travel_min: travelMinutes(km), lat: p.lat, lng: p.lng, address: p.address };
    },
    nearest(type, lat, lng, extraWhere) {
      const rows = db.all(`SELECT * FROM providers WHERE type = ? AND verified_status = 'verified' AND is_open = 1 ${extraWhere || ''}`, [type]);
      return rows
        .map((p) => Object.assign(p, { distance_km: Math.round(haversineKm(lat, lng, p.lat, p.lng) * 10) / 10 }))
        .sort((a, b) => a.distance_km - b.distance_km);
    },
  };
}

// Simulates provider apps / POS systems pushing availability. One provider is
// deliberately left stale so the "availability unconfirmed" state is visible.
function tick(c) {
  const now = c.now().toISOString();
  c.db.run("UPDATE providers SET availability_updated_at = ? WHERE id != 'prv_doc_stale'", [now]);
  // release expired slot holds
  c.db.run("UPDATE slots SET status = 'open', hold_expires_at = NULL WHERE status = 'held' AND hold_expires_at < ? AND id NOT IN (SELECT slot_id FROM bookings WHERE status IN ('requested','confirmed','checked_in','in_consult','completed'))", [now]);
}

module.exports = { register, api, tick };
