'use strict';
// wellness: daily routines and habit streaks, personalised preventive
// guidance, and Dadi Ke Nuskhe — traditional remedies kept clearly separate
// from medical treatment, with red-flag symptoms routed to a doctor or SOS.

const { must, json, localDay, addMinutes, ageFrom, seasonFor } = require('../util');

const RED_FLAGS = [
  { words: ['chest pain', 'chest tightness', 'heart attack'], route: 'sos', why: 'Chest pain can be a heart emergency.' },
  { words: ['breathless', 'can\'t breathe', 'cannot breathe', 'difficulty breathing', 'shortness of breath'], route: 'sos', why: 'Breathing difficulty needs urgent care.' },
  { words: ['unconscious', 'fainted', 'not responding', 'seizure', 'fits'], route: 'sos', why: 'Loss of consciousness or a seizure is an emergency.' },
  { words: ['face drooping', 'slurred speech', 'one side weak', 'stroke'], route: 'sos', why: 'These are stroke warning signs — every minute matters.' },
  { words: ['heavy bleeding', 'vomiting blood', 'blood in vomit', 'black stool'], route: 'sos', why: 'Heavy or internal bleeding needs emergency care.' },
  { words: ['high fever', 'fever for 3 days', 'fever 3 days', 'fever since 3'], route: 'doctor', why: 'Fever lasting 3+ days should be seen by a doctor.' },
  { words: ['blood in urine', 'severe headache', 'severe pain', 'pregnan', 'child not eating', 'dehydrat'], route: 'doctor', why: 'This needs a doctor’s assessment, not a home remedy.' },
  { words: ['sugar very high', 'sugar very low', 'sugar 300', 'sugar 50', 'hypo'], route: 'doctor', why: 'Very high or low blood sugar needs medical advice today.' },
];

function register(r, c) {
  const { db } = c;

  r.get('/api/wellness', ({ user }) => {
    const day = localDay(c.now());
    const routines = c.api.routinesToday(user.id);
    const card = db.get('SELECT * FROM emergency_cards WHERE patient_id = ?', [user.id]);
    return {
      season: seasonFor(c.now()),
      routines,
      guidance: preventive(user, card),
      day,
    };
  });

  r.post('/api/wellness/routines', ({ user, body }) => {
    must(body.title, 400, 'Routine name is required');
    const id = c.util.id('rtn');
    db.run('INSERT INTO routines (id, user_id, title, target, unit, icon) VALUES (?, ?, ?, ?, ?, ?)', [id, user.id, body.title, body.target || 1, body.unit || 'times', body.icon || 'spark']);
    return { id };
  });

  r.post('/api/wellness/routines/:id/log', ({ user, params, body }) => {
    const rt = db.get('SELECT * FROM routines WHERE id = ? AND user_id = ?', [params.id, user.id]);
    must(rt, 404, 'Routine not found');
    const day = localDay(c.now());
    const cur = db.get('SELECT count FROM habit_logs WHERE routine_id = ? AND day = ?', [rt.id, day]);
    const next = Math.max(0, Math.min(rt.target * 2, (cur ? cur.count : 0) + (Number(body.delta) || 1)));
    db.run('INSERT OR REPLACE INTO habit_logs (routine_id, day, count) VALUES (?, ?, ?)', [rt.id, day, next]);
    return { routines: c.api.routinesToday(user.id) };
  });

  // Dadi Ke Nuskhe library, filtered by season and by the member's own
  // allergies, conditions and medicines (DN-5).
  r.get('/api/remedies', ({ user, query }) => {
    const patientId = query.member ? c.consent.resolve(user, query.member, 'reports', 'wellness personalisation') : user.id;
    const card = db.get('SELECT * FROM emergency_cards WHERE patient_id = ?', [patientId]) || {};
    const meds = db.all('SELECT drug FROM schedules WHERE patient_id = ? AND active = 1', [patientId]).map((s) => s.drug.toLowerCase());
    const personal = []
      .concat(json(card.allergies, []), json(card.conditions, []))
      .map((x) => String(x).toLowerCase())
      .concat(meds);
    const season = query.season || seasonFor(c.now());
    let rows = db.all('SELECT * FROM remedies ORDER BY title', []);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((r0) => (r0.title + r0.hindi + r0.goal + r0.when_to_use + r0.ingredients).toLowerCase().includes(q));
    }
    const shown = [];
    const hidden = [];
    for (const r0 of rows) {
      const avoid = json(r0.avoid_if, []);
      const clash = avoid.find((a) => personal.some((p) => p.includes(a.toLowerCase())));
      const item = Object.assign({}, r0, { seasons: json(r0.seasons, []), ingredients: json(r0.ingredients, []), avoid_if: avoid });
      if (clash) hidden.push({ id: r0.id, title: r0.title, reason: `Not suggested with ${clash}` });
      else shown.push(Object.assign(item, { in_season: item.seasons.includes(season) || item.seasons.includes('all') }));
    }
    shown.sort((a, b) => (a.in_season === b.in_season ? 0 : a.in_season ? -1 : 1));
    return {
      season,
      disclaimer: 'Traditional wellness information — it does not replace professional medical diagnosis or treatment.',
      items: shown,
      hidden,
    };
  });

  // DN-6: symptom words → red flags go to SOS or a doctor, never to a remedy.
  r.post('/api/remedies/check', ({ body }) => {
    const text = String(body.text || '').toLowerCase();
    must(text.trim().length > 1, 400, 'Describe how you feel');
    for (const f of RED_FLAGS) {
      if (f.words.some((w) => text.includes(w))) {
        return { route: f.route, message: f.why, cta: f.route === 'sos' ? 'Call 112 / Start SOS' : 'Consult a doctor now' };
      }
    }
    const rows = db.all('SELECT id, title, hindi, goal FROM remedies', []);
    const words = text.split(/\W+/).filter((w) => w.length > 3);
    const matches = rows.filter((r0) => words.some((w) => (r0.goal + ' ' + r0.title).toLowerCase().includes(w)));
    return {
      route: 'remedies',
      message: matches.length ? 'These traditional practices may help with comfort. See a doctor if it does not improve in 2–3 days.' : 'No matching remedy. If you are unwell, a doctor consult is the safest next step.',
      matches,
    };
  });

  function preventive(u, card) {
    const age = u.dob ? ageFrom(u.dob, c.now()) : null;
    const conditions = json(card && card.conditions, []).map((x) => String(x).toLowerCase());
    const out = [];
    if (age !== null && age >= 30) out.push({ title: 'Annual blood sugar check', why: 'Recommended yearly after 30 for early detection of diabetes.', action: '#/book?type=lab&q=Sugar' });
    if (age !== null && age >= 35) out.push({ title: 'Lipid profile every year', why: 'Tracks cholesterol, a major heart-risk factor.', action: '#/book?type=lab&q=Lipid' });
    if (age !== null && age >= 40) out.push({ title: 'Blood pressure check monthly', why: 'High BP often has no symptoms.', action: '#/book?type=doctor' });
    if (conditions.some((x) => x.includes('diabet'))) out.push({ title: 'HbA1c every 3 months', why: 'Shows average sugar control over 3 months.', action: '#/book?type=lab&q=HbA1c' });
    if (u.sex === 'F' && age >= 21) out.push({ title: 'Cervical screening', why: 'Every 3 years from 21 on a doctor’s advice.', action: '#/book?type=doctor' });
    out.push({ title: '30 minutes of brisk walking', why: '150 minutes a week lowers heart and diabetes risk.', action: '#/wellness' });
    return out;
  }
}

function api(c) {
  return {
    routinesToday(userId) {
      const day = localDay(c.now());
      return c.db.all('SELECT * FROM routines WHERE user_id = ? ORDER BY rowid', [userId]).map((rt) => {
        const log = c.db.get('SELECT count FROM habit_logs WHERE routine_id = ? AND day = ?', [rt.id, day]);
        let streak = 0;
        for (let i = 1; i < 60; i++) {
          const d = localDay(addMinutes(c.now(), -i * 1440));
          const l = c.db.get('SELECT count FROM habit_logs WHERE routine_id = ? AND day = ?', [rt.id, d]);
          if (l && l.count >= rt.target) streak++;
          else break;
        }
        const done = log ? log.count : 0;
        return Object.assign(rt, { done, complete: done >= rt.target, streak: streak + (done >= rt.target ? 1 : 0) });
      });
    },
  };
}

module.exports = { register, api, RED_FLAGS };
