'use strict';
// reminders: dose schedules built from prescriptions, dose actions, missed-dose
// escalation to caregivers, refill alerts and check-up / follow-up reminders.

const { must, json, addMinutes, startOfDay, localDay } = require('../util');

const SLOT_TIMES = ['08:30', '13:30', '20:30']; // morning-afternoon-night
const REPROMPT_MIN = 15;
const MISSED_MIN = 60;

function timesForFrequency(freq) {
  if (!freq || /sos/i.test(freq)) return [];
  if (/weekly/i.test(freq)) return ['09:00'];
  const parts = String(freq).split('-');
  const out = [];
  parts.forEach((p, i) => {
    if ((parseFloat(p) || 0) > 0 && SLOT_TIMES[i]) out.push(SLOT_TIMES[i]);
  });
  return out.length ? out : ['09:00'];
}

function register(r, c) {
  const { db } = c;

  r.get('/api/reminders/today', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'medicines', 'today doses');
    return {
      doses: c.api.dosesForDay(patientId, c.now()),
      reminders: db.all('SELECT * FROM reminders WHERE patient_id = ? AND done = 0 ORDER BY due_on', [patientId]),
    };
  });

  r.post('/api/reminders/doses/:id', ({ user, params, body }) => {
    const ev = db.get('SELECT * FROM dose_events WHERE id = ?', [params.id]);
    must(ev, 404, 'Dose not found');
    c.consent.resolve(user, ev.patient_id, 'medicines', 'log dose');
    const now = c.now();
    const action = body.action;
    must(['taken', 'snooze', 'skip'].includes(action), 400, 'Action must be taken, snooze or skip');
    if (action === 'taken') {
      must(['due', 'snoozed', 'missed'].includes(ev.status), 400, 'Dose already logged');
      db.run('UPDATE dose_events SET status = ?, acted_at = ?, acted_by = ?, camera_verified = ? WHERE id = ?', [
        'taken',
        now.toISOString(),
        user.id,
        body.camera_verified ? 1 : 0,
        ev.id,
      ]);
      const s = db.get('SELECT * FROM schedules WHERE id = ?', [ev.schedule_id]);
      if (s.stock_left !== null && s.stock_left !== undefined) {
        db.run('UPDATE schedules SET stock_left = MAX(0, stock_left - 1) WHERE id = ?', [s.id]);
        checkRefill(c, db.get('SELECT * FROM schedules WHERE id = ?', [s.id]));
      }
      if (ev.status === 'missed') {
        for (const w of c.consent.watchers(ev.patient_id, 'medicines')) {
          c.notify.send(w, { kind: 'dose', title: `${patientName(ev.patient_id)} took ${s.drug} (late)`, body: 'Logged just now.' });
        }
      }
    } else if (action === 'snooze') {
      must(['due', 'snoozed'].includes(ev.status), 400, 'Only a due dose can be snoozed');
      const mins = [10, 30].includes(Number(body.minutes)) ? Number(body.minutes) : 10;
      db.run('UPDATE dose_events SET status = ?, snooze_until = ? WHERE id = ?', ['snoozed', addMinutes(now, mins).toISOString(), ev.id]);
    } else {
      must(['due', 'snoozed', 'missed'].includes(ev.status), 400, 'Dose already logged');
      db.run('UPDATE dose_events SET status = ?, acted_at = ?, acted_by = ?, skip_reason = ? WHERE id = ?', ['skipped', now.toISOString(), user.id, body.reason || '', ev.id]);
    }
    return { dose: c.api.dosesForDay(ev.patient_id, new Date(ev.due_at)).find((d) => d.id === ev.id) };
  });

  r.get('/api/schedules', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'medicines', 'schedules');
    const since = addMinutes(c.now(), -7 * 1440).toISOString();
    const rows = db.all('SELECT * FROM schedules WHERE patient_id = ? AND active = 1 ORDER BY drug', [patientId]);
    return {
      items: rows.map((s) => {
        const st = db.all("SELECT status, COUNT(*) AS n FROM dose_events WHERE schedule_id = ? AND due_at >= ? AND due_at <= ? AND status IN ('taken','missed','skipped') GROUP BY status", [
          s.id,
          since,
          c.now().toISOString(),
        ]);
        const n = (k) => (st.find((x) => x.status === k) || { n: 0 }).n;
        const total = n('taken') + n('missed') + n('skipped');
        return Object.assign(s, {
          times: json(s.times, []),
          adherence_7d: total ? Math.round((n('taken') / total) * 100) : null,
          days_left: s.stock_left === null || s.stock_left === undefined ? null : Math.floor(s.stock_left / Math.max(1, json(s.times, []).length)),
        });
      }),
    };
  });

  r.post('/api/schedules', ({ user, body }) => {
    const patientId = c.consent.resolve(user, body.member_id, 'medicines', 'add schedule');
    must(body.drug, 400, 'Medicine name is required');
    const times = (body.times && body.times.length ? body.times : timesForFrequency(body.frequency || '1-0-0')).filter((t) => /^\d\d:\d\d$/.test(t));
    must(times.length, 400, 'Add at least one time');
    const id = createSchedule(c, {
      patient_id: patientId,
      drug: body.drug,
      dose: body.dose || '1 tablet',
      instructions: body.instructions || '',
      times,
      days: body.days || 30,
      stock_left: body.stock_left === undefined ? null : body.stock_left,
    });
    return { id };
  });

  r.put('/api/schedules/:id', ({ user, params, body }) => {
    const s = db.get('SELECT * FROM schedules WHERE id = ?', [params.id]);
    must(s, 404, 'Schedule not found');
    c.consent.resolve(user, s.patient_id, 'medicines', 'edit schedule');
    if (body.active === false) {
      db.run('UPDATE schedules SET active = 0 WHERE id = ?', [s.id]);
      db.run("DELETE FROM dose_events WHERE schedule_id = ? AND status = 'due' AND due_at > ?", [s.id, c.now().toISOString()]);
    }
    if (body.stock_left !== undefined) db.run('UPDATE schedules SET stock_left = ? WHERE id = ?', [body.stock_left, s.id]);
  });

  r.get('/api/reminders', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'appointments', 'reminders');
    return { items: db.all('SELECT * FROM reminders WHERE patient_id = ? AND done = 0 ORDER BY due_on', [patientId]) };
  });

  r.post('/api/reminders/:id/done', ({ user, params }) => {
    const rem = db.get('SELECT * FROM reminders WHERE id = ?', [params.id]);
    must(rem, 404, 'Reminder not found');
    c.consent.resolve(user, rem.patient_id, 'appointments', 'complete reminder');
    db.run('UPDATE reminders SET done = 1 WHERE id = ?', [rem.id]);
  });

  function patientName(id) {
    const u = db.get('SELECT name FROM users WHERE id = ?', [id]);
    return u ? u.name.split(' ')[0] : 'Family member';
  }
}

function createSchedule(c, s) {
  const id = c.util.id('sch');
  const start = localDay(c.now());
  const end = localDay(addMinutes(c.now(), (s.days || 30) * 1440));
  c.db.run(
    'INSERT INTO schedules (id, patient_id, prescription_id, drug, dose, instructions, times, start_on, end_on, grace_min, stock_left, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [id, s.patient_id, s.prescription_id || null, s.drug, s.dose, s.instructions, JSON.stringify(s.times), s.start_on || start, s.end_on || end, REPROMPT_MIN, s.stock_left === undefined ? null : s.stock_left]
  );
  return id;
}

function checkRefill(c, s) {
  if (!s || s.stock_left === null || s.stock_left === undefined) return;
  const perDay = Math.max(1, json(s.times, []).length);
  if (s.stock_left / perDay > 5) return;
  if (s.end_on && s.end_on <= localDay(addMinutes(c.now(), 5 * 1440))) return; // course ending anyway
  const open = c.db.get("SELECT id FROM reminders WHERE patient_id = ? AND kind = 'refill' AND title LIKE ? AND done = 0", [s.patient_id, `%${s.drug}%`]);
  if (open) return;
  c.db.run('INSERT INTO reminders (id, patient_id, kind, title, due_on, action) VALUES (?, ?, ?, ?, ?, ?)', [
    c.util.id('rem'),
    s.patient_id,
    'refill',
    `Refill ${s.drug} — ${Math.floor(s.stock_left / perDay)} days left`,
    localDay(c.now()),
    s.prescription_id ? `#/rx/${s.prescription_id}` : '#/store',
  ]);
  c.notify.send(s.patient_id, { kind: 'refill', title: `Running low on ${s.drug}`, body: 'Order a refill from your prescription in one tap.', link: s.prescription_id ? `#/rx/${s.prescription_id}` : '#/store' });
}

// Make sure dose events exist for a patient's day, then apply time rules.
function ensureDay(c, patientId, day) {
  const d0 = startOfDay(day);
  const dayStr = localDay(d0);
  const schedules = c.db.all('SELECT * FROM schedules WHERE patient_id = ? AND active = 1 AND start_on <= ? AND (end_on IS NULL OR end_on >= ?)', [patientId, dayStr, dayStr]);
  for (const s of schedules) {
    const times = json(s.times, []);
    const weekly = times.length === 1 && times[0] === '09:00' && /weekly|sachet/i.test(s.dose + s.instructions);
    if (weekly && new Date(`${s.start_on}T00:00:00`).getDay() !== d0.getDay()) continue;
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const due = new Date(d0);
      due.setHours(h, m, 0, 0);
      const evId = `dose_${s.id}_${dayStr}_${t.replace(':', '')}`;
      if (!c.db.get('SELECT id FROM dose_events WHERE id = ?', [evId])) {
        c.db.run('INSERT INTO dose_events (id, schedule_id, patient_id, due_at, status) VALUES (?, ?, ?, ?, ?)', [evId, s.id, patientId, due.toISOString(), 'due']);
      }
    }
  }
}

function sweep(c, patientId) {
  const now = c.now();
  const nowIso = now.toISOString();
  const args = patientId ? [nowIso, patientId] : [nowIso];
  const rows = c.db.all(
    `SELECT d.*, s.drug, s.dose FROM dose_events d JOIN schedules s ON s.id = d.schedule_id
     WHERE d.status IN ('due','snoozed') AND d.due_at <= ? ${patientId ? 'AND d.patient_id = ?' : ''}`,
    args
  );
  for (const d of rows) {
    const mins = (now - new Date(d.due_at)) / 60000;
    if (d.status === 'snoozed' && d.snooze_until && d.snooze_until <= nowIso && mins < MISSED_MIN) {
      c.db.run("UPDATE dose_events SET status = 'due', snooze_until = NULL WHERE id = ?", [d.id]);
      c.notify.send(d.patient_id, { kind: 'dose', title: `Snoozed reminder: ${d.drug}`, body: `${d.dose} — tap to mark taken`, link: '#/home' });
      continue;
    }
    if (mins >= MISSED_MIN) {
      c.db.run("UPDATE dose_events SET status = 'missed' WHERE id = ?", [d.id]);
      c.events.emit('dose.missed', { dose_id: d.id, patient_id: d.patient_id, drug: d.drug, due_at: d.due_at });
    } else if (mins >= REPROMPT_MIN && d.reminded < 2) {
      c.db.run('UPDATE dose_events SET reminded = 2 WHERE id = ?', [d.id]);
      c.notify.send(d.patient_id, { kind: 'dose', title: `Reminder: ${d.drug} still pending`, body: `${d.dose} was due at ${new Date(d.due_at).toTimeString().slice(0, 5)}`, link: '#/home' });
    } else if (mins >= 0 && d.reminded < 1) {
      c.db.run('UPDATE dose_events SET reminded = 1 WHERE id = ?', [d.id]);
      c.notify.send(d.patient_id, { kind: 'dose', title: `Time to take ${d.drug}`, body: `${d.dose}. Tap to mark taken.`, link: '#/home' });
    }
  }
}

function api(c) {
  return {
    dosesForDay(patientId, day) {
      ensureDay(c, patientId, day);
      sweep(c, patientId);
      const d0 = startOfDay(day);
      const rows = c.db.all(
        `SELECT d.*, s.drug, s.dose, s.instructions, s.stock_left FROM dose_events d JOIN schedules s ON s.id = d.schedule_id
         WHERE d.patient_id = ? AND d.due_at >= ? AND d.due_at < ? ORDER BY d.due_at`,
        [patientId, d0.toISOString(), addMinutes(d0, 1440).toISOString()]
      );
      const now = c.now();
      return rows.map((d) => {
        let status = d.status;
        if (status === 'due' && new Date(d.due_at) > now) status = 'upcoming';
        const dt = new Date(d.due_at);
        return {
          id: d.id,
          schedule_id: d.schedule_id,
          drug: d.drug,
          dose: d.dose,
          instructions: d.instructions,
          due_at: d.due_at,
          time_label: dt.toTimeString().slice(0, 5),
          status,
          acted_at: d.acted_at,
          camera_verified: !!d.camera_verified,
          escalated: !!d.escalated,
          snooze_until: d.snooze_until,
        };
      });
    },
    createSchedule: (s) => createSchedule(c, s),
    timesForFrequency,
  };
}

function subscribe(c) {
  // Prescription → dose schedules, no typing by the patient (MR-1).
  c.events.on('rx.issued', ({ prescription_id }) => {
    const rx = c._rx.get(prescription_id);
    for (const it of rx.items) {
      const times = timesForFrequency(it.frequency);
      if (!times.length) continue; // "as needed" medicines get no fixed reminder
      createSchedule(c, {
        patient_id: rx.patient_id,
        prescription_id: rx.id,
        drug: it.drug,
        dose: it.dose || '1 tablet',
        instructions: [it.food, /weekly/i.test(it.frequency) ? 'weekly' : ''].filter(Boolean).join(' · '),
        times,
        days: it.days || 30,
        stock_left: 0,
      });
    }
  });

  // Caregiver escalation (MR-5): everyone with medicines consent is told.
  c.events.on('dose.missed', ({ dose_id, patient_id, drug, due_at }) => {
    const p = c.db.get('SELECT name FROM users WHERE id = ?', [patient_id]);
    const watchers = c.consent.watchers(patient_id, 'medicines');
    for (const w of watchers) {
      c.notify.send(w, {
        kind: 'missed_dose',
        title: `${p.name.split(' ')[0]} missed ${drug}`,
        body: `Due at ${new Date(due_at).toTimeString().slice(0, 5)}. Give them a call?`,
        link: `#/family`,
        channels: ['push', 'sms'],
      });
    }
    c.db.run('UPDATE dose_events SET escalated = ? WHERE id = ?', [watchers.length ? 1 : 0, dose_id]);
  });
}

function tick(c) {
  const now = c.now();
  for (const p of c.db.all('SELECT DISTINCT patient_id FROM schedules WHERE active = 1', [])) {
    ensureDay(c, p.patient_id, now);
    ensureDay(c, p.patient_id, addMinutes(now, 1440));
  }
  sweep(c, null);
}

module.exports = { register, api, subscribe, tick, timesForFrequency };
