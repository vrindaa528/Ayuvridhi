'use strict';
// records: lifelong timeline (birth → senior care), uploads with
// auto-categorisation, lab trends, Emergency Card, time-limited sharing.

const { must, json, ageFrom, addMinutes, localDay, validate } = require('../util');

const TYPES = ['prescription', 'lab_report', 'consultation', 'vaccination', 'discharge', 'imaging', 'medicine', 'emergency', 'document', 'milestone'];

function stageFor(age) {
  if (age === null || age === undefined) return null;
  if (age < 6) return { key: 'early_childhood', label: 'Early childhood' };
  if (age < 18) return { key: 'youth', label: 'Youth & fitness' };
  if (age < 60) return { key: 'adulthood', label: 'Adulthood' };
  return { key: 'senior', label: 'Senior care' };
}

// OCR stand-in: classify an upload from its file name / title words.
function classify(name) {
  const n = String(name || '').toLowerCase();
  if (/rx|prescri/.test(n)) return 'prescription';
  if (/cbc|lab|report|blood|lipid|thyroid|hba1c|sugar|test/.test(n)) return 'lab_report';
  if (/x-?ray|mri|ct|scan|ultra|usg|echo/.test(n)) return 'imaging';
  if (/discharge/.test(n)) return 'discharge';
  if (/vaccin|immuni/.test(n)) return 'vaccination';
  return 'document';
}

function register(r, c) {
  const { db } = c;

  r.get('/api/records/timeline', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'reports', 'view timeline');
    const p = db.get('SELECT * FROM users WHERE id = ?', [patientId]);
    const args = [patientId];
    let where = 'patient_id = ?';
    if (query.type) {
      where += ' AND type = ?';
      args.push(query.type);
    }
    if (query.q) {
      where += ' AND (title LIKE ? OR provider LIKE ? OR summary LIKE ?)';
      args.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
    }
    const rows = db.all(`SELECT * FROM records WHERE ${where} ORDER BY date DESC, created_at DESC`, args);
    const items = rows.map((rec) => {
      const age = p.dob ? ageFrom(p.dob, new Date(`${rec.date}T12:00:00`)) : null;
      return Object.assign(rec, { age_at: age, stage: stageFor(age) });
    });
    const counts = {};
    for (const t of TYPES) counts[t] = 0;
    for (const it of db.all('SELECT type, COUNT(*) AS n FROM records WHERE patient_id = ? GROUP BY type', [patientId])) counts[it.type] = it.n;
    const upcoming = db.all('SELECT * FROM reminders WHERE patient_id = ? AND done = 0 ORDER BY due_on LIMIT 5', [patientId]);
    return {
      patient: { id: p.id, name: p.name, dob: p.dob, age: p.dob ? ageFrom(p.dob, c.now()) : null, abha_id: p.abha_id, stage: stageFor(p.dob ? ageFrom(p.dob, c.now()) : null) },
      items,
      counts,
      upcoming,
      types: TYPES,
    };
  });

  r.get('/api/records/trends', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'reports', 'view trends');
    const rows = db.all('SELECT test, value, unit, ref_range, date FROM lab_values WHERE patient_id = ? ORDER BY date', [patientId]);
    const byTest = {};
    for (const v of rows) (byTest[v.test] = byTest[v.test] || { test: v.test, unit: v.unit, ref_range: v.ref_range, points: [] }).points.push({ date: v.date, value: v.value });
    return { items: Object.values(byTest).filter((t) => t.points.length >= 2) };
  });

  r.get('/api/records/:id', ({ user, params }) => {
    const rec = db.get('SELECT * FROM records WHERE id = ?', [params.id]);
    must(rec, 404, 'Record not found');
    c.consent.resolve(user, rec.patient_id, 'reports', 'view record');
    rec.values = db.all('SELECT test, value, unit, ref_range FROM lab_values WHERE record_id = ?', [rec.id]);
    return rec;
  });

  r.post('/api/records', { rate: [{ by: 'user', name: 'upload', limit: 20, windowMs: 60 * 60000 }] }, ({ user, body }) => {
    validate(body, {
      title: { max: 120 },
      file_name: { max: 200 },
      type: { max: 30 },
      date: { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'date must be YYYY-MM-DD' },
      provider: { max: 120 },
      member_id: { max: 60 },
      values: { type: 'array', max: 200 },
    });
    const patientId = c.consent.resolve(user, body.member_id, 'reports', 'add record');
    const title = body.title || (body.file_name ? body.file_name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') : 'Document');
    const type = TYPES.includes(body.type) ? body.type : classify(`${body.file_name || ''} ${title}`);
    const rec = c.api.addRecord({
      patient_id: patientId,
      type,
      title,
      provider: body.provider || '',
      date: body.date || localDay(c.now()),
      summary: body.summary || '',
      file_name: body.file_name || null,
      source: 'upload',
      values: (body.values || []).filter((v) => v.test && v.value !== ''),
    });
    return Object.assign(rec, { auto_classified: !TYPES.includes(body.type) });
  });

  r.get('/api/emergency-card', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'reports', 'view emergency card');
    return card(patientId);
  });

  r.put('/api/emergency-card', ({ user, body }) => {
    const patientId = c.consent.resolve(user, body.member_id, 'reports', 'edit emergency card');
    // Only the patient or their guardian edits the card.
    must(patientId === user.id || c.consent.isGuardian(user.id, patientId), 403, 'Only the patient or guardian can edit the Emergency Card');
    const cur = card(patientId);
    const next = {
      blood_group: body.blood_group !== undefined ? body.blood_group : cur.blood_group,
      allergies: body.allergies || cur.allergies,
      conditions: body.conditions || cur.conditions,
      medicines: body.medicines || cur.medicines,
      contacts: body.contacts || cur.contacts,
      notes: body.notes !== undefined ? body.notes : cur.notes,
    };
    db.run('INSERT OR REPLACE INTO emergency_cards (patient_id, blood_group, allergies, conditions, medicines, contacts, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      patientId,
      next.blood_group,
      JSON.stringify(next.allergies),
      JSON.stringify(next.conditions),
      JSON.stringify(next.medicines),
      JSON.stringify(next.contacts),
      next.notes || '',
      c.now().toISOString(),
    ]);
    if (next.blood_group) db.run('UPDATE users SET blood_group = ? WHERE id = ?', [next.blood_group, patientId]);
    return card(patientId);
  });

  // HR-9: time-limited share link for a doctor outside the platform.
  r.post('/api/records/:id/share', { rate: [{ by: 'user', name: 'share-link', limit: 20, windowMs: 60 * 60000 }] }, ({ user, params, body }) => {
    const rec = db.get('SELECT * FROM records WHERE id = ?', [params.id]);
    must(rec, 404, 'Record not found');
    must(rec.patient_id === user.id || c.consent.isGuardian(user.id, rec.patient_id), 403, 'Only the patient or guardian can share records');
    const minutes = Math.min(7 * 1440, Math.max(15, Number(body.minutes) || 1440));
    const token = c.util.secureToken(24); // unguessable: this is a bearer secret
    db.run('INSERT INTO consents (id, grantor_id, grantee_id, categories, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      token,
      rec.patient_id,
      `share:${body.recipient || 'link'}`,
      JSON.stringify(['record:' + rec.id]),
      'share_link',
      addMinutes(c.now(), minutes).toISOString(),
      c.now().toISOString(),
    ]);
    return { token, path: `/api/shared/${token}`, expires_at: addMinutes(c.now(), minutes).toISOString() };
  });

  r.get('/api/shared/:token', { auth: false }, ({ params }) => {
    const k = db.get("SELECT * FROM consents WHERE id = ? AND purpose = 'share_link' AND revoked_at IS NULL", [params.token]);
    must(k && k.expires_at > c.now().toISOString(), 410, 'This share link has expired');
    const recId = json(k.categories, [])[0].replace('record:', '');
    const rec = db.get('SELECT * FROM records WHERE id = ?', [recId]);
    c.consent.log(k.grantee_id, k.grantor_id, 'reports', 'share link opened');
    rec.values = db.all('SELECT test, value, unit, ref_range FROM lab_values WHERE record_id = ?', [rec.id]);
    return { record: rec, expires_at: k.expires_at };
  });

  function card(patientId) {
    const k = db.get('SELECT * FROM emergency_cards WHERE patient_id = ?', [patientId]) || {};
    const u = db.get('SELECT name, dob, blood_group, abha_id FROM users WHERE id = ?', [patientId]);
    const meds = db.all('SELECT DISTINCT drug FROM schedules WHERE patient_id = ? AND active = 1', [patientId]).map((s) => s.drug);
    return {
      patient_id: patientId,
      name: u.name,
      age: u.dob ? ageFrom(u.dob, c.now()) : null,
      abha_id: u.abha_id,
      blood_group: k.blood_group || u.blood_group,
      allergies: json(k.allergies, []),
      conditions: json(k.conditions, []),
      medicines: json(k.medicines, []).length ? json(k.medicines, []) : meds,
      contacts: json(k.contacts, []),
      notes: k.notes || '',
      updated_at: k.updated_at,
    };
  }

  c._card = card;
}

function api(c) {
  return {
    addRecord(rec) {
      const id = c.util.id('rec');
      c.db.run('INSERT INTO records (id, patient_id, type, title, provider, date, summary, file_name, source, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        rec.patient_id,
        rec.type,
        rec.title,
        rec.provider || '',
        rec.date,
        rec.summary || '',
        rec.file_name || null,
        rec.source || 'upload',
        rec.ref_id || null,
        rec.created_at || c.now().toISOString(),
      ]);
      for (const v of rec.values || []) {
        c.db.run('INSERT INTO lab_values (record_id, patient_id, test, value, unit, ref_range, date) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          id,
          rec.patient_id,
          v.test,
          Number(v.value),
          v.unit || '',
          v.ref_range || '',
          rec.date,
        ]);
      }
      c.events.emit('record.added', { record_id: id, patient_id: rec.patient_id });
      return c.db.get('SELECT * FROM records WHERE id = ?', [id]);
    },
    emergencyCard: (patientId) => c._card(patientId),
  };
}

module.exports = { register, api, classify, stageFor };
