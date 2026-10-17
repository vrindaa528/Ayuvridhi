'use strict';
// sos: one tap → family and emergency contacts alerted with live location,
// nearest ER found and pre-informed with the Emergency Card (time-boxed
// consent), ambulance requested from partners, 112/108 always one tap away.

const { must, json, haversineKm, travelMinutes, addMinutes } = require('../util');

function register(r, c) {
  const { db } = c;

  function step(sosId, key, detail) {
    db.run('INSERT INTO sos_steps (sos_id, step, detail, at) VALUES (?, ?, ?, ?)', [sosId, key, detail, c.now().toISOString()]);
  }

  // Rate limit stops a stuck button or an abusive client from flooding caregivers.
  r.post('/api/sos', { rate: [{ by: 'user', name: 'sos-create', limit: 5, windowMs: 10 * 60000, message: 'Too many SOS requests. If this is a real emergency, call 112.' }] }, ({ user, body }) => {
    const patientId = body.member_id || user.id;
    if (patientId !== user.id) must(c.consent.can(user.id, patientId, 'location') || c.consent.isGuardian(user.id, patientId), 403, 'No consent to raise SOS for this member');
    const existing = db.get("SELECT id FROM sos_events WHERE patient_id = ? AND status = 'active'", [patientId]);
    if (existing) return status(existing.id, user.id);

    const p = db.get('SELECT * FROM users WHERE id = ?', [patientId]);
    const lat = Number(body.lat) || p.lat || 19.076;
    const lng = Number(body.lng) || p.lng || 72.8777;
    const now = c.now();
    const id = c.util.id('sos');
    db.run('INSERT INTO sos_events (id, patient_id, triggered_by, status, lat, lng, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, patientId, user.id, 'active', lat, lng, now.toISOString()]);
    db.run('INSERT INTO sos_locations (sos_id, lat, lng, at) VALUES (?, ?, ?, ?)', [id, lat, lng, now.toISOString()]);
    step(id, 'triggered', `${patientId !== user.id ? `Raised by ${user.name} for ${p.name}` : `Raised by ${p.name}`} from the ${body.source || 'app'}`);
    step(id, 'location_shared', `Live location ${lat.toFixed(4)}, ${lng.toFixed(4)} shared`);

    // 1. Family with location consent + Emergency Card contacts.
    const card = c.api.emergencyCard(patientId);
    const told = [];
    const watchers = new Set(c.consent.watchers(patientId, 'location'));
    const fam = c.consent.familyOf(patientId);
    if (fam && c.consent.isGuardian(fam.leader_id, patientId)) watchers.add(fam.leader_id);
    watchers.delete(user.id);
    for (const w of watchers) {
      const wu = db.get('SELECT name FROM users WHERE id = ?', [w]);
      c.notify.send(w, {
        kind: 'sos',
        title: `SOS — ${p.name} needs help`,
        body: `Live location: https://maps.google.com/?q=${lat},${lng}`,
        link: `#/sos/${id}`,
        channels: ['push', 'sms', 'call'],
      });
      told.push(wu.name);
    }
    for (const ct of card.contacts) {
      if (told.includes(ct.name)) continue;
      c.log('sms', `SOS SMS to ${ct.name} (${ct.phone}): ${p.name} needs help. Location https://maps.google.com/?q=${lat},${lng}`);
      told.push(ct.name);
    }
    step(id, 'contacts_notified', told.length ? `${told.join(', ')} notified by push + SMS` : 'No contacts on Emergency Card — add one');

    // 2. Nearest hospital with an active ER gets the Emergency Card.
    const er = c.api.nearest('hospital', lat, lng, 'AND has_er = 1')[0];
    if (er) {
      c.consent.grantTemporary(patientId, er.id, ['reports', 'prescriptions', 'medicines'], 'emergency', 6 * 60);
      c.consent.log(er.id, patientId, 'reports', 'emergency card during SOS');
      db.run('UPDATE sos_events SET hospital_id = ? WHERE id = ?', [er.id, id]);
      step(id, 'hospital_notified', `${er.name} ER alerted · ${er.distance_km} km · Emergency Card shared`);
    }

    // 3. Ambulance from the partner network.
    const amb = c.api.nearest('ambulance', lat, lng)[0];
    if (amb) {
      let eta = travelMinutes(haversineKm(lat, lng, amb.lat, amb.lng));
      if (c.deps.maxDemoEtaMin) eta = Math.min(eta, c.deps.maxDemoEtaMin + 2);
      const unit = `${amb.name} #${10 + Math.floor(Math.random() * 20)}`;
      db.run('UPDATE sos_events SET ambulance = ?, ambulance_eta_at = ? WHERE id = ?', [unit, addMinutes(now, eta).toISOString(), id]);
      step(id, 'ambulance_assigned', `${unit} assigned · ETA ${eta} min`);
    } else {
      step(id, 'ambulance_fallback', 'No partner ambulance free — call 108');
    }
    step(id, 'emergency_card_shared', `Blood group ${card.blood_group || 'unknown'} · ${card.conditions.join(', ') || 'no conditions listed'} · Allergies: ${card.allergies.join(', ') || 'none listed'}`);
    c.events.emit('sos.started', { sos_id: id, patient_id: patientId });
    return status(id, user.id);
  });

  r.get('/api/sos/active', ({ user }) => {
    const mine = db.all("SELECT id FROM sos_events WHERE status = 'active' AND (patient_id = ? OR triggered_by = ?)", [user.id, user.id]);
    const fam = c.consent.familyOf(user.id);
    const others = fam
      ? db.all("SELECT s.id, s.patient_id FROM sos_events s JOIN family_members m ON m.user_id = s.patient_id WHERE m.family_id = ? AND s.status = 'active'", [fam.id]).filter((s) => c.consent.can(user.id, s.patient_id, 'location'))
      : [];
    const ids = Array.from(new Set(mine.map((x) => x.id).concat(others.map((x) => x.id))));
    return { items: ids.map((i) => status(i, user.id)) };
  });

  r.get('/api/sos/:id', ({ user, params }) => {
    const s = db.get('SELECT * FROM sos_events WHERE id = ?', [params.id]);
    must(s, 404, 'SOS not found');
    must(s.patient_id === user.id || s.triggered_by === user.id || c.consent.can(user.id, s.patient_id, 'location'), 403, 'No access to this SOS');
    return status(s.id, user.id);
  });

  r.post('/api/sos/:id/location', ({ user, params, body }) => {
    const s = db.get("SELECT * FROM sos_events WHERE id = ? AND status = 'active'", [params.id]);
    must(s && (s.patient_id === user.id || s.triggered_by === user.id), 400, 'SOS is not active');
    db.run('INSERT INTO sos_locations (sos_id, lat, lng, at) VALUES (?, ?, ?, ?)', [s.id, Number(body.lat), Number(body.lng), c.now().toISOString()]);
    db.run('UPDATE sos_events SET lat = ?, lng = ? WHERE id = ?', [Number(body.lat), Number(body.lng), s.id]);
  });

  r.post('/api/sos/:id/doctor', ({ user, params }) => {
    const s = db.get("SELECT * FROM sos_events WHERE id = ? AND status = 'active'", [params.id]);
    must(s && (s.patient_id === user.id || s.triggered_by === user.id || c.consent.can(user.id, s.patient_id, 'location')), 400, 'SOS is not active');
    const doc = db.get("SELECT * FROM providers WHERE type = 'doctor' AND specialty = 'Emergency Medicine' AND verified_status = 'verified'", []);
    step(s.id, 'doctor_joined', `${doc ? doc.name : 'Emergency doctor'} joined by video to guide first aid`);
    return status(s.id, user.id);
  });

  r.post('/api/sos/:id/close', ({ user, params, body }) => {
    const s = db.get("SELECT * FROM sos_events WHERE id = ? AND status = 'active'", [params.id]);
    must(s, 400, 'SOS is not active');
    must(s.patient_id === user.id || s.triggered_by === user.id || c.consent.can(user.id, s.patient_id, 'location'), 403, 'Not allowed');
    const now = c.now().toISOString();
    db.run("UPDATE sos_events SET status = 'closed', closed_at = ?, close_reason = ? WHERE id = ?", [now, body.reason || 'resolved', s.id]);
    // Emergency grants end with the SOS.
    db.run("UPDATE consents SET revoked_at = ? WHERE grantor_id = ? AND purpose = 'emergency' AND revoked_at IS NULL", [now, s.patient_id]);
    step(s.id, 'closed', `Closed by ${user.name} · ${body.reason === 'false_alarm' ? 'false alarm' : 'resolved'} · emergency access revoked`);
    const hosp = s.hospital_id ? db.get('SELECT name FROM providers WHERE id = ?', [s.hospital_id]) : null;
    if (body.reason !== 'false_alarm') {
      c.api.addRecord({
        patient_id: s.patient_id,
        type: 'emergency',
        title: 'Emergency SOS',
        provider: hosp ? hosp.name : '',
        date: c.util.localDay(new Date(s.started_at)),
        summary: `SOS from ${new Date(s.started_at).toTimeString().slice(0, 5)} to ${new Date(now).toTimeString().slice(0, 5)}. ${s.ambulance ? 'Ambulance: ' + s.ambulance + '.' : ''}`,
        source: 'sos',
        ref_id: s.id,
      });
    }
    for (const w of c.consent.watchers(s.patient_id, 'location')) {
      if (w === user.id) continue;
      c.notify.send(w, { kind: 'sos', title: 'SOS closed', body: `${user.name.split(' ')[0]} marked the emergency as ${body.reason === 'false_alarm' ? 'a false alarm' : 'resolved'}.` });
    }
    c.events.emit('sos.closed', { sos_id: s.id });
    return status(s.id, user.id);
  });

  function status(id, viewerId) {
    const s = db.get('SELECT * FROM sos_events WHERE id = ?', [id]);
    const p = db.get('SELECT id, name, phone FROM users WHERE id = ?', [s.patient_id]);
    const hosp = s.hospital_id ? db.get('SELECT id, name, address, lat, lng FROM providers WHERE id = ?', [s.hospital_id]) : null;
    const steps = db.all('SELECT step, detail, at FROM sos_steps WHERE sos_id = ? ORDER BY id', [id]);
    const trail = db.all('SELECT lat, lng, at FROM sos_locations WHERE sos_id = ? ORDER BY id DESC LIMIT 20', [id]);
    const etaLeft = s.ambulance_eta_at ? Math.max(0, Math.ceil((new Date(s.ambulance_eta_at) - c.now()) / 60000)) : null;
    return {
      id: s.id,
      status: s.status,
      patient: p,
      is_me: s.patient_id === viewerId,
      started_at: s.started_at,
      closed_at: s.closed_at,
      location: { lat: s.lat, lng: s.lng },
      trail,
      hospital: hosp,
      ambulance: s.ambulance ? { unit: s.ambulance, eta_at: s.ambulance_eta_at, eta_min_left: etaLeft, arrived: etaLeft === 0 } : null,
      emergency_card: c.api.emergencyCard(s.patient_id),
      steps,
      helplines: [
        { label: 'Emergency 112', number: '112' },
        { label: 'Ambulance 108', number: '108' },
      ],
    };
  }

  c._sos = { status, step };
}

function tick(c) {
  const now = c.now().toISOString();
  for (const s of c.db.all("SELECT * FROM sos_events WHERE status = 'active' AND ambulance_eta_at <= ?", [now])) {
    if (!c.db.get("SELECT id FROM sos_steps WHERE sos_id = ? AND step = 'ambulance_arrived'", [s.id])) {
      c._sos.step(s.id, 'ambulance_arrived', `${s.ambulance} has reached the location`);
    }
  }
}

module.exports = { register, tick };
