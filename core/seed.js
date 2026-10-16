'use strict';
// Demo data: the Kumar joint family in Andheri West, Mumbai, plus verified
// providers nearby. Dose times are placed relative to "now" so the home screen
// always shows a taken, a missed (escalated) and an upcoming dose.

const { addMinutes, localDay, startOfDay } = require('./util');

function seed(core) {
  const c = core.c;
  const { db } = c;
  if (db.get('SELECT COUNT(*) AS n FROM users', []).n > 0) return false;
  const now = c.now();
  const ago = (days) => addMinutes(now, -days * 1440);
  const day = (days) => localDay(ago(days));
  const iso = (d) => new Date(d).toISOString();
  const J = JSON.stringify;
  const HOME = { lat: 19.1197, lng: 72.8464 }; // Andheri West

  // ---------- users & family ----------
  const users = [
    ['usr_rajesh', '9876500001', 'Rajesh Kumar', '1984-03-12', 'M', 'B+', '91-4521-7788-3021'],
    ['usr_sunita', '9876500002', 'Sunita Kumar', '1987-08-21', 'F', 'O+', '91-4521-7788-4410'],
    ['usr_kamla', '9876500003', 'Kamla Devi', '1958-06-02', 'F', 'B+', '91-6610-2290-1187'],
    ['usr_ramesh', '9876500004', 'Ramesh Kumar', '1954-01-15', 'M', 'A+', '91-6610-2290-1192'],
    ['usr_arjun', null, 'Arjun Kumar', '2018-05-10', 'M', 'B+', null],
  ];
  for (const u of users) {
    db.run('INSERT INTO users (id, phone, name, dob, sex, blood_group, abha_id, language, city, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[0] === 'usr_kamla' ? 'hi' : 'en', 'Mumbai', HOME.lat, HOME.lng, iso(ago(200)),
    ]);
  }
  db.run('INSERT INTO families (id, name, leader_id) VALUES (?, ?, ?)', ['fam_kumar', 'Kumar Family', 'usr_rajesh']);
  for (const [uid, role, rel] of [
    ['usr_rajesh', 'leader', 'Self'],
    ['usr_sunita', 'caregiver', 'Wife'],
    ['usr_kamla', 'member', 'Mother'],
    ['usr_ramesh', 'member', 'Father'],
    ['usr_arjun', 'dependent', 'Son'],
  ]) {
    db.run('INSERT INTO family_members (family_id, user_id, role, relation) VALUES (?, ?, ?, ?)', ['fam_kumar', uid, role, rel]);
  }
  const grants = [
    ['usr_kamla', 'usr_rajesh', ['medicines', 'appointments', 'prescriptions', 'reports', 'location', 'payments']],
    ['usr_kamla', 'usr_sunita', ['medicines', 'location']],
    ['usr_ramesh', 'usr_rajesh', ['medicines', 'appointments', 'prescriptions', 'reports', 'location']],
    ['usr_sunita', 'usr_rajesh', ['appointments', 'location']],
    ['usr_rajesh', 'usr_sunita', ['appointments', 'location', 'medicines']],
    ['usr_rajesh', 'usr_kamla', ['location']],
  ];
  for (const [g, to, cats] of grants) {
    db.run('INSERT INTO consents (id, grantor_id, grantee_id, categories, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?)', [c.util.id('cns'), g, to, J(cats), 'family_care', iso(ago(90))]);
  }
  const cards = [
    ['usr_rajesh', 'B+', [], [], [{ name: 'Sunita Kumar', phone: '9876500002', relation: 'Wife' }]],
    ['usr_sunita', 'O+', ['Sulfa drugs'], [], [{ name: 'Rajesh Kumar', phone: '9876500001', relation: 'Husband' }]],
    ['usr_kamla', 'B+', ['Penicillin'], ['Type 2 diabetes'], [{ name: 'Rajesh Kumar', phone: '9876500001', relation: 'Son' }, { name: 'Sunita Kumar', phone: '9876500002', relation: 'Daughter-in-law' }]],
    ['usr_ramesh', 'A+', [], ['Hypertension', 'High cholesterol'], [{ name: 'Rajesh Kumar', phone: '9876500001', relation: 'Son' }]],
    ['usr_arjun', 'B+', ['Peanuts'], [], [{ name: 'Rajesh Kumar', phone: '9876500001', relation: 'Father' }, { name: 'Sunita Kumar', phone: '9876500002', relation: 'Mother' }]],
  ];
  for (const k of cards) {
    db.run('INSERT INTO emergency_cards (patient_id, blood_group, allergies, conditions, medicines, contacts, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [k[0], k[1], J(k[2]), J(k[3]), '[]', J(k[4]), '', iso(ago(30))]);
  }

  // ---------- providers ----------
  const P = (o) =>
    db.run(
      `INSERT INTO providers (id, type, name, specialty, qualification, reg_no, lat, lng, address, fee, languages, rating, verified_status, verified_until,
        accreditation, has_er, avg_wait_min, queue_len, home_collection, services, is_open, availability_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        o.id, o.type, o.name, o.specialty || null, o.qualification || null, o.reg, o.lat, o.lng, o.address, o.fee || 0,
        J(o.languages || ['English', 'Hindi']), o.rating || 4.5, o.status || 'verified', o.status === 'pending' ? null : day(-300),
        o.accreditation || null, o.er ? 1 : 0, o.wait || 15, o.queue || 0, o.home ? 1 : 0, J(o.services || []), 1,
        iso(o.stale ? ago(0.05) : now),
      ]
    );
  const labTests = (k) => [
    { name: 'Complete Blood Count (CBC)', price: Math.round(350 * k) },
    { name: 'HbA1c', price: Math.round(450 * k) },
    { name: 'Lipid Profile', price: Math.round(600 * k) },
    { name: 'Thyroid Profile (T3, T4, TSH)', price: Math.round(550 * k) },
    { name: 'Fasting Blood Sugar', price: Math.round(120 * k) },
    { name: 'Vitamin D (25-OH)', price: Math.round(900 * k) },
  ];
  [
    { id: 'prv_doc_priya', type: 'doctor', name: 'Dr. Priya Sharma', specialty: 'Cardiologist', qualification: 'MBBS, MD, DM (Cardiology)', reg: 'MMC/2009/38214', lat: 19.1136, lng: 72.8697, address: 'Heartline Clinic, Andheri East', fee: 600, rating: 4.8, languages: ['English', 'Hindi', 'Marathi'], wait: 15, queue: 2 },
    { id: 'prv_doc_anil', type: 'doctor', name: 'Dr. Anil Mehta', specialty: 'General Physician', qualification: 'MBBS, MD (Medicine)', reg: 'MMC/2004/22107', lat: 19.125, lng: 72.84, address: 'Mehta Clinic, Lokhandwala, Andheri West', fee: 400, rating: 4.6, wait: 10, queue: 1 },
    { id: 'prv_doc_neha', type: 'doctor', name: 'Dr. Neha Iyer', specialty: 'Pediatrician', qualification: 'MBBS, DCH', reg: 'MMC/2012/51790', lat: 19.1075, lng: 72.8263, address: 'Little Steps Child Clinic, Juhu', fee: 500, rating: 4.9, languages: ['English', 'Hindi', 'Tamil'], wait: 20, queue: 3 },
    { id: 'prv_doc_farhan', type: 'doctor', name: 'Dr. Farhan Qureshi', specialty: 'Endocrinologist', qualification: 'MBBS, MD, DM (Endocrinology)', reg: 'MMC/2008/36650', lat: 19.0596, lng: 72.8295, address: 'Hormone & Diabetes Centre, Bandra West', fee: 800, rating: 4.7, languages: ['English', 'Hindi', 'Urdu'], wait: 25 },
    { id: 'prv_doc_kavita', type: 'doctor', name: 'Dr. Kavita Rao', specialty: 'Dermatologist', qualification: 'MBBS, MD (DVL)', reg: 'MMC/2014/58210', lat: 19.131, lng: 72.835, address: 'SkinFirst, Versova', fee: 550, rating: 4.5, wait: 15 },
    { id: 'prv_doc_stale', type: 'doctor', name: 'Dr. Sameer Joshi', specialty: 'General Physician', qualification: 'MBBS', reg: 'MMC/2010/40112', lat: 19.118, lng: 72.855, address: 'Joshi Clinic, Andheri West', fee: 350, rating: 4.3, stale: true },
    { id: 'prv_doc_emerg', type: 'doctor', name: 'Dr. Rohan Desai', specialty: 'Emergency Medicine', qualification: 'MBBS, MEM', reg: 'MMC/2011/45821', lat: 19.117, lng: 72.848, address: 'Metro Hospital, Andheri West', fee: 499, rating: 4.8 },
    { id: 'prv_doc_vikram', type: 'doctor', name: 'Dr. Vikram Malhotra', specialty: 'Orthopaedic', qualification: 'MBBS, MS (Ortho)', reg: 'MMC/2016/61234', lat: 19.121, lng: 72.851, address: 'BoneCare, Andheri West', fee: 700, status: 'pending' },
    { id: 'prv_doc_sanjay', type: 'doctor', name: 'Dr. Sanjay K.', specialty: 'General Physician', qualification: 'MBBS', reg: 'ABC12345', lat: 19.13, lng: 72.86, address: 'Andheri', fee: 200, status: 'pending' },
    { id: 'prv_hosp_metro', type: 'hospital', name: 'Metro Hospital', specialty: 'Multispeciality · 24×7 Trauma ER', reg: 'IN2710MUMB01', lat: 19.117, lng: 72.848, address: 'SV Road, Andheri West', fee: 500, rating: 4.4, er: true, accreditation: 'NABH', wait: 30, queue: 6 },
    { id: 'prv_hosp_sahyadri', type: 'hospital', name: 'Sahyadri Multispeciality Hospital', specialty: 'Multispeciality · ER', reg: 'IN2710MUMB07', lat: 19.102, lng: 72.837, address: 'Juhu Tara Road, Juhu', fee: 600, rating: 4.5, er: true, accreditation: 'NABH', wait: 35, queue: 4 },
    { id: 'prv_clinic_family', type: 'clinic', name: 'Andheri Family Clinic', specialty: 'General OPD', reg: 'IN2710MUMC12', lat: 19.122, lng: 72.844, address: 'Four Bungalows, Andheri West', fee: 300, rating: 4.2, wait: 10 },
    { id: 'prv_ph_sanjeevani', type: 'pharmacy', name: 'Sanjeevani Pharmacy', reg: 'MH-MZ1-204511', lat: 19.1215, lng: 72.844, address: 'JP Road, Andheri West', rating: 4.7, accreditation: 'Licensed · Form 20/21' },
    { id: 'prv_ph_healthfirst', type: 'pharmacy', name: 'HealthFirst Chemist', reg: 'MH-MZ1-198340', lat: 19.115, lng: 72.8505, address: 'Azad Nagar, Andheri West', rating: 4.5, accreditation: 'Licensed · Form 20/21' },
    { id: 'prv_ph_apna', type: 'pharmacy', name: 'Apna Medical Store', reg: 'MH-MZ2-176602', lat: 19.13, lng: 72.836, address: 'Yari Road, Versova', rating: 4.3, accreditation: 'Licensed · Form 20/21' },
    { id: 'prv_ph_quick', type: 'pharmacy', name: 'QuickMeds 24×7', reg: 'MH-MZ1-2045', lat: 19.126, lng: 72.852, address: 'Andheri West', status: 'pending' },
    { id: 'prv_lab_pathcare', type: 'lab', name: 'Pathcare Diagnostics', specialty: 'Pathology · Home collection', reg: 'MC-2874', lat: 19.119, lng: 72.847, address: 'Lokhandwala, Andheri West', fee: 350, rating: 4.6, accreditation: 'NABL', home: true, services: labTests(1) },
    { id: 'prv_lab_precision', type: 'lab', name: 'Precision Labs', specialty: 'Pathology · Imaging', reg: 'MC-3310', lat: 19.109, lng: 72.838, address: 'Juhu Scheme, Vile Parle West', fee: 380, rating: 4.4, accreditation: 'NABL', home: true, services: labTests(0.92) },
    { id: 'prv_amb_citycare', type: 'ambulance', name: 'City Care Ambulance', reg: 'MH02AB1234', lat: 19.11, lng: 72.85, address: 'Andheri depot' },
    { id: 'prv_amb_lifeline', type: 'ambulance', name: 'Lifeline 24×7 Ambulance', reg: 'MH02CD5678', lat: 19.135, lng: 72.84, address: 'Versova depot' },
  ].forEach(P);
  for (const p of db.all("SELECT id, type FROM providers WHERE verified_status = 'verified'", [])) {
    const reg = { doctor: 'ABDM Healthcare Professionals Registry lookup', pharmacy: 'State drug controller lookup', lab: 'NABL directory lookup', hospital: 'ABDM Health Facility Registry lookup', clinic: 'ABDM Health Facility Registry lookup', ambulance: 'RTO / state EMS lookup' }[p.type];
    for (const k of ['Registration number format', reg, 'Identity and documents reviewed']) {
      db.run('INSERT INTO verifications (provider_id, check_name, result, at) VALUES (?, ?, ?, ?)', [p.id, k, 'pass', iso(ago(65))]);
    }
  }

  // ---------- pharmacy stock ----------
  const DRUGS = require('./modules/pharmacy').DRUGS;
  const stockPlan = {
    prv_ph_sanjeevani: { k: 1.0, missing: [] },
    prv_ph_healthfirst: { k: 0.95, missing: ['Atorvastatin 10mg', 'Levothyroxine 50mcg'] },
    prv_ph_apna: { k: 0.88, missing: ['Mometasone cream 0.1%', 'BP monitor (upper arm)', 'Telmisartan 40mg'] },
  };
  for (const pid of Object.keys(stockPlan)) {
    for (const drug of Object.keys(DRUGS)) {
      if (stockPlan[pid].missing.includes(drug)) continue;
      const price = Math.round(DRUGS[drug].mrp * stockPlan[pid].k * 100) / 100;
      db.run('INSERT INTO stock (pharmacy_id, drug, qty, price, updated_at) VALUES (?, ?, ?, ?, ?)', [pid, drug, ['tablet', 'sachet'].includes(DRUGS[drug].unit) ? 400 : 25, price, iso(now)]);
    }
  }

  // ---------- past consults, prescriptions, schedules ----------
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, '0')}`;
  const d0 = startOfDay(now);
  const clampToday = (d) => new Date(Math.min(Math.max(d.getTime(), d0.getTime() + 5 * 60000), d0.getTime() + (23 * 60 + 55) * 60000));
  const tTaken = hhmm(clampToday(addMinutes(now, -240)));
  const tMissed = hhmm(clampToday(addMinutes(now, -95)));
  const tNext = hhmm(clampToday(addMinutes(now, 120)));

  function pastRx(id, patient, doctor, daysAgo, diagnosis, notes, items) {
    const bid = `bkg_${id}`;
    db.run('INSERT INTO bookings (id, patient_id, booked_by, provider_id, slot_id, type, mode, service, status, price, token_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      bid, patient, 'usr_rajesh', doctor, null, 'doctor', 'video', 'Consultation', 'completed', 0, 'A-07', iso(ago(daysAgo)), iso(ago(daysAgo)),
    ]);
    db.run('INSERT INTO consultations (id, booking_id, doctor_id, patient_id, notes, follow_up_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`cst_${id}`, bid, doctor, patient, notes, day(daysAgo - 60), iso(ago(daysAgo))]);
    db.run('INSERT INTO prescriptions (id, consultation_id, patient_id, doctor_id, diagnosis, items, source, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, `cst_${id}`, patient, doctor, diagnosis, J(items), 'e-prescription', iso(ago(daysAgo))]);
    const doc = db.get('SELECT name FROM providers WHERE id = ?', [doctor]);
    c.api.addRecord({ patient_id: patient, type: 'prescription', title: `Prescription — ${doc.name}`, provider: doc.name, date: day(daysAgo), summary: `${diagnosis}. ${items.map((i) => i.drug).join(', ')}`, file_name: `Rx_${id}.pdf`, source: 'consult', ref_id: id, created_at: iso(ago(daysAgo)) });
    c.api.addRecord({ patient_id: patient, type: 'consultation', title: `Video consult — ${doc.name}`, provider: doc.name, date: day(daysAgo), summary: notes, source: 'consult', ref_id: `cst_${id}`, created_at: iso(ago(daysAgo)) });
  }
  pastRx('rx_kamla_1', 'usr_kamla', 'prv_doc_anil', 20, 'Type 2 diabetes with dyslipidaemia', 'Sugar control improving (HbA1c 6.9%). Continue walk and diet. Repeat HbA1c in 3 months.', [
    { drug: 'Metformin 500mg', dose: '1 tablet', frequency: '1-0-0', food: 'after food', days: 60 },
    { drug: 'Atorvastatin 10mg', dose: '1 tablet', frequency: '0-1-0', food: 'after food', days: 60 },
    { drug: 'Multivitamin Complex', dose: '1 tablet', frequency: '0-0-1', food: 'after dinner', days: 60 },
  ]);
  pastRx('rx_ramesh_1', 'usr_ramesh', 'prv_doc_priya', 34, 'Hypertension with dyslipidaemia', 'BP 142/90. Low-salt diet, daily 30-min walk. Lipid profile in 6 weeks.', [
    { drug: 'Amlodipine 5mg', dose: '1 tablet', frequency: '1-0-0', food: 'after food', days: 90 },
    { drug: 'Telmisartan 40mg', dose: '1 tablet', frequency: '0-0-1', food: 'after food', days: 90 },
  ]);

  const sched = (id, patient, rx, drug, instr, time, stock) => {
    db.run('INSERT INTO schedules (id, patient_id, prescription_id, drug, dose, instructions, times, start_on, end_on, grace_min, stock_left, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)', [
      id, patient, rx, drug, '1 tablet', instr, J([time]), day(20), day(-40), 15, stock,
    ]);
  };
  sched('sch_k_met', 'usr_kamla', 'rx_kamla_1', 'Metformin 500mg', 'after food', tTaken, 38);
  sched('sch_k_ator', 'usr_kamla', 'rx_kamla_1', 'Atorvastatin 10mg', 'after food', tMissed, 4);
  sched('sch_k_multi', 'usr_kamla', 'rx_kamla_1', 'Multivitamin Complex', 'after dinner', tNext, 30);
  sched('sch_r_amlo', 'usr_ramesh', 'rx_ramesh_1', 'Amlodipine 5mg', 'after food', tTaken, 52);
  sched('sch_r_telmi', 'usr_ramesh', 'rx_ramesh_1', 'Telmisartan 40mg', 'after food', tNext, 52);
  sched('sch_me_multi', 'usr_rajesh', null, 'Multivitamin Complex', 'after dinner', tNext, 24);

  // 7 days of history so adherence numbers are real.
  const hist = [
    ['sch_k_met', 'usr_kamla', tTaken, [1, 1, 1, 1, 1, 1, 1]],
    ['sch_k_ator', 'usr_kamla', tMissed, [1, 0, 1, 1, 1, 0, 1]],
    ['sch_k_multi', 'usr_kamla', tNext, [1, 1, 1, 0, 1, 1, 1]],
    ['sch_r_amlo', 'usr_ramesh', tTaken, [1, 1, 1, 1, 1, 1, 1]],
    ['sch_r_telmi', 'usr_ramesh', tNext, [1, 1, 0, 1, 1, 1, 1]],
    ['sch_me_multi', 'usr_rajesh', tNext, [1, 0, 1, 1, 0, 1, 1]],
  ];
  for (const [sid, pid, t, marks] of hist) {
    marks.forEach((ok, i) => {
      const dd = addMinutes(d0, -(i + 1) * 1440);
      const [h, m] = t.split(':').map(Number);
      const due = new Date(dd);
      due.setHours(h, m, 0, 0);
      db.run('INSERT INTO dose_events (id, schedule_id, patient_id, due_at, status, acted_at, camera_verified, reminded, escalated) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?)', [
        `dose_${sid}_${localDay(dd)}_${t.replace(':', '')}`, sid, pid, due.toISOString(), ok ? 'taken' : 'missed', ok ? addMinutes(due, 6).toISOString() : null, ok && pid === 'usr_kamla' ? 1 : 0, ok ? 0 : 1,
      ]);
    });
  }
  // Today: taken dose (camera-verified), the rest left to the live rules.
  for (const [sid, pid] of [['sch_k_met', 'usr_kamla'], ['sch_r_amlo', 'usr_ramesh']]) {
    const [h, m] = tTaken.split(':').map(Number);
    const due = new Date(d0);
    due.setHours(h, m, 0, 0);
    db.run('INSERT INTO dose_events (id, schedule_id, patient_id, due_at, status, acted_at, acted_by, camera_verified, reminded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)', [
      `dose_${sid}_${localDay(d0)}_${tTaken.replace(':', '')}`, sid, pid, due.toISOString(), 'taken', addMinutes(due, 4).toISOString(), pid, pid === 'usr_kamla' ? 1 : 0,
    ]);
  }

  // ---------- lifelong records ----------
  const rec = (patient, type, title, provider, date, summary, values) => c.api.addRecord({ patient_id: patient, type, title, provider, date, summary, file_name: `${title.replace(/\W+/g, '_')}.pdf`, source: 'seed', values, created_at: new Date(`${date}T10:00:00`).toISOString() });
  const hba1c = [[day(370), 7.8], [day(275), 7.4], [day(180), 7.1], [day(85), 6.9]];
  for (const [d, v] of hba1c) rec('usr_kamla', 'lab_report', 'HbA1c', 'Pathcare Diagnostics', d, `HbA1c ${v}%`, [{ test: 'HbA1c', value: v, unit: '%', ref_range: '< 5.7' }]);
  rec('usr_kamla', 'lab_report', 'Fasting Blood Sugar', 'Pathcare Diagnostics', day(85), 'FBS 128 mg/dL', [{ test: 'Fasting blood sugar', value: 128, unit: 'mg/dL', ref_range: '70–100' }]);
  rec('usr_kamla', 'lab_report', 'Fasting Blood Sugar', 'Pathcare Diagnostics', day(180), 'FBS 141 mg/dL', [{ test: 'Fasting blood sugar', value: 141, unit: 'mg/dL', ref_range: '70–100' }]);
  rec('usr_kamla', 'discharge', 'Discharge summary — cataract surgery (right eye)', 'Sahyadri Multispeciality Hospital', '2019-02-14', 'Phacoemulsification with IOL, uneventful recovery.');
  rec('usr_kamla', 'vaccination', 'Influenza vaccine (annual)', 'Andheri Family Clinic', day(358), 'Quadrivalent influenza vaccine.');
  rec('usr_kamla', 'milestone', 'Diagnosed: Type 2 diabetes', 'Dr. Anil Mehta', '2016-09-03', 'Started on lifestyle changes and Metformin.');

  rec('usr_ramesh', 'lab_report', 'Lipid Profile', 'Precision Labs', day(150), 'LDL 132 mg/dL', [{ test: 'LDL cholesterol', value: 132, unit: 'mg/dL', ref_range: '< 100' }, { test: 'HDL cholesterol', value: 41, unit: 'mg/dL', ref_range: '> 40' }]);
  rec('usr_ramesh', 'lab_report', 'Lipid Profile', 'Precision Labs', day(40), 'LDL 118 mg/dL', [{ test: 'LDL cholesterol', value: 118, unit: 'mg/dL', ref_range: '< 100' }, { test: 'HDL cholesterol', value: 44, unit: 'mg/dL', ref_range: '> 40' }]);
  rec('usr_ramesh', 'imaging', 'ECG — normal sinus rhythm', 'Heartline Clinic', day(34), 'No acute changes.');
  rec('usr_ramesh', 'imaging', '2D Echo', 'Metro Hospital', day(400), 'EF 60%, mild LVH.');

  rec('usr_rajesh', 'lab_report', 'Annual health check — CBC', 'Pathcare Diagnostics', day(210), 'All values in range.', [{ test: 'Haemoglobin', value: 14.6, unit: 'g/dL', ref_range: '13–17' }]);
  rec('usr_rajesh', 'lab_report', 'Lipid Profile', 'Pathcare Diagnostics', day(210), 'LDL 104 mg/dL', [{ test: 'LDL cholesterol', value: 104, unit: 'mg/dL', ref_range: '< 100' }]);
  rec('usr_rajesh', 'vaccination', 'COVID-19 booster', 'BMC vaccination centre', '2022-07-18', 'Precaution dose.');
  rec('usr_sunita', 'lab_report', 'Thyroid Profile (T3, T4, TSH)', 'Precision Labs', day(240), 'TSH 3.1 mIU/L', [{ test: 'TSH', value: 3.1, unit: 'mIU/L', ref_range: '0.4–4.0' }]);

  const kid = [
    ['milestone', 'Birth record — 3.1 kg, Apgar 9/10', 'Sahyadri Multispeciality Hospital', '2018-05-10', 'Normal delivery, healthy baby boy.'],
    ['vaccination', 'BCG, OPV-0, Hepatitis B-1', 'Sahyadri Multispeciality Hospital', '2018-05-10', 'Birth doses.'],
    ['vaccination', 'Pentavalent-1, OPV-1, Rotavirus-1', 'Little Steps Child Clinic', '2018-06-21', '6-week doses.'],
    ['vaccination', 'MMR-1', 'Little Steps Child Clinic', '2019-02-12', '9-month dose.'],
    ['milestone', 'Growth check — 9.8 kg, 76 cm', 'Dr. Neha Iyer', '2019-05-14', 'Growth on 50th percentile.'],
    ['vaccination', 'DPT booster-1, MMR-2', 'Little Steps Child Clinic', '2019-11-15', '16–24 month doses.'],
    ['vaccination', 'DPT booster-2', 'Little Steps Child Clinic', '2023-05-16', '5-year booster.'],
    ['consultation', 'Peanut allergy confirmed', 'Dr. Neha Iyer', '2021-03-08', 'Avoid peanuts; carry antihistamine.'],
    ['document', 'Vision check — 6/6 both eyes', 'School health camp', '2024-09-12', 'Normal vision.'],
    ['document', 'Dental check-up', 'Smile Dental, Andheri', day(130), 'No cavities. Next visit in 6 months.'],
    ['document', 'School sports physical — fit', 'Dr. Neha Iyer', day(60), 'Fit for all sports.'],
  ];
  for (const k of kid) rec('usr_arjun', k[0], k[1], k[2], k[3], k[4]);

  // ---------- reminders ----------
  const R = (pid, kind, title, inDays, action) =>
    db.run('INSERT INTO reminders (id, patient_id, kind, title, due_on, action) VALUES (?, ?, ?, ?, ?, ?)', [c.util.id('rem'), pid, kind, title, day(-inDays), action]);
  R('usr_kamla', 'checkup', 'HbA1c test due (every 3 months)', 6, '#/book?type=lab&q=HbA1c');
  R('usr_kamla', 'refill', 'Refill Atorvastatin 10mg — 4 days left', 0, '#/rx/rx_kamla_1');
  R('usr_ramesh', 'checkup', 'Lipid profile — 6 weeks after starting treatment', 3, '#/book?type=lab&q=Lipid');
  R('usr_arjun', 'vaccination', 'Influenza vaccine (annual)', 4, '#/book?type=doctor&specialty=Pediatrician');
  R('usr_arjun', 'checkup', 'Dental check-up (6-monthly)', 10, '#/book?type=clinic');
  R('usr_rajesh', 'checkup', 'Annual health check', 20, '#/book?type=lab&q=CBC');

  // ---------- an upcoming confirmed booking ----------
  const tomorrow = addMinutes(now, 1440);
  const priya = db.get('SELECT * FROM providers WHERE id = ?', ['prv_doc_priya']);
  c.api.ensureSlots(priya, tomorrow);
  const slot = db.get("SELECT * FROM slots WHERE provider_id = ? AND start_at >= ? AND status = 'open' ORDER BY start_at LIMIT 1 OFFSET 3", [priya.id, iso(startOfDay(tomorrow))]);
  if (slot) {
    db.run("UPDATE slots SET status = 'booked' WHERE id = ?", [slot.id]);
    db.run('INSERT INTO transactions (id, payer_id, member_id, category, ref_id, description, amount, direction, method, status, escrow_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      'txn_seed_priya', 'usr_rajesh', 'usr_ramesh', 'consult', 'bkg_seed_priya', 'Cardiologist consultation · Dr. Priya Sharma', 600, 'debit', 'UPI', 'captured', 'held', iso(ago(1)),
    ]);
    db.run('INSERT INTO bookings (id, patient_id, booked_by, provider_id, slot_id, type, mode, service, status, price, token_no, txn_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      'bkg_seed_priya', 'usr_ramesh', 'usr_rajesh', priya.id, slot.id, 'doctor', 'clinic', 'Cardiologist consultation', 'confirmed', 600, 'A-04', 'txn_seed_priya', iso(ago(1)), iso(ago(1)),
    ]);
    db.run('INSERT INTO reminders (id, patient_id, kind, title, due_on, action) VALUES (?, ?, ?, ?, ?, ?)', [c.util.id('rem'), 'usr_ramesh', 'appointment', `Cardiologist consultation · Dr. Priya Sharma at ${new Date(slot.start_at).toTimeString().slice(0, 5)}`, localDay(tomorrow), '#/booking/bkg_seed_priya']);
  }

  // ---------- wallet ----------
  const T = (id, member, cat, desc, amt, dir, daysAgo, escrow, ref) =>
    db.run('INSERT INTO transactions (id, payer_id, member_id, category, ref_id, description, amount, direction, method, status, escrow_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, 'usr_rajesh', member, cat, ref || id, desc, amt, dir, 'UPI', dir === 'debit' ? 'captured' : 'refunded_to_source', escrow, iso(ago(daysAgo)),
    ]);
  T('txn_s1', 'usr_kamla', 'consult', 'General Physician consultation · Dr. Anil Mehta', 400, 'debit', 20, 'released');
  T('txn_s2', 'usr_kamla', 'pharmacy', 'Monthly Rx · Sanjeevani Pharmacy', 1120, 'debit', 19, 'released');
  T('txn_s3', 'usr_rajesh', 'lab', 'HbA1c · Pathcare Diagnostics (home collection)', 450, 'debit', 9, 'refunded');
  T('txn_s4', 'usr_rajesh', 'lab', 'Refund · Lab test rescheduled', 450, 'credit', 8, 'n/a', 'txn_s3');
  T('txn_s5', 'usr_rajesh', 'subscription', 'Family Care Plan · UPI AutoPay mandate', 199, 'debit', 3, 'released');
  T('txn_s6', 'usr_arjun', 'consult', 'Pediatrician consultation · Dr. Neha Iyer', 500, 'debit', 6, 'released');
  T('txn_s7', 'usr_ramesh', 'pharmacy', 'Rx order · HealthFirst Chemist', 742, 'debit', 33, 'released');
  db.run('INSERT INTO subscriptions (id, user_id, plan, price, period, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)', ['sub_seed', 'usr_rajesh', 'family_care', 199, 'month', 'active', day(-27)]);
  for (const o of [
    ['FIRSTLAB', '20% off your first lab test (max ₹200)', 'lab', 20, 200],
    ['CARE10', '10% off any consultation (max ₹100)', 'consult', 10, 100],
    ['RXSAVE', '5% off medicine orders (max ₹75)', 'pharmacy', 5, 75],
  ]) {
    db.run('INSERT INTO offers (code, title, category, pct, max_off, active) VALUES (?, ?, ?, ?, ?, 1)', o);
  }

  // ---------- wellness ----------
  const routines = [
    ['rtn_water', 'Drink water', 8, 'glasses', 'water', [8, 8, 7, 8, 8, 8], 5],
    ['rtn_walk', 'Brisk walk', 1, '30 min', 'walk', [1, 1, 1, 1, 0, 1], 0],
    ['rtn_sleep', 'Sleep by 11 pm', 1, 'night', 'moon', [1, 1, 0, 1, 1, 1], 0],
    ['rtn_pranayama', 'Pranayama', 1, '10 min', 'breath', [1, 1, 1, 0, 0, 1], 1],
  ];
  for (const [id, title, target, unit, icon, past, today] of routines) {
    db.run('INSERT INTO routines (id, user_id, title, target, unit, icon) VALUES (?, ?, ?, ?, ?, ?)', [id, 'usr_rajesh', title, target, unit, icon]);
    past.forEach((n, i) => db.run('INSERT INTO habit_logs (routine_id, day, count) VALUES (?, ?, ?)', [id, day(i + 1), n]));
    if (today) db.run('INSERT INTO habit_logs (routine_id, day, count) VALUES (?, ?, ?)', [id, day(0), today]);
  }

  const REM = [
    ['Haldi doodh', 'हल्दी दूध', 'Soothing for cough, cold and better sleep', ['winter', 'monsoon', 'autumn'], ['1 cup milk', '½ tsp turmeric', 'pinch of black pepper', 'optional: ginger'], 'Simmer milk with turmeric and pepper for 3–4 minutes. Drink warm at bedtime.', 'Mild cough or cold, tiredness', 'Cough lasting over 2 weeks, fever, or breathing difficulty.', ['warfarin', 'gallstones']],
    ['Tulsi-adrak kadha', 'तुलसी-अदरक काढ़ा', 'Comfort for sore throat and seasonal cold', ['monsoon', 'winter'], ['8–10 tulsi leaves', '1 inch ginger', '2 cloves', '2 cups water'], 'Boil everything until reduced to one cup. Sip warm, twice a day.', 'Sore throat, blocked nose, seasonal cold', 'Fever beyond 3 days, chest pain or breathlessness.', ['warfarin']],
    ['Jeera pani', 'जीरा पानी', 'Eases bloating and supports digestion', ['all'], ['1 tsp cumin seeds', '1 glass water'], 'Boil cumin in water for 5 minutes, strain and drink warm after meals.', 'Bloating, heaviness after meals', 'Severe abdominal pain, vomiting or blood in stool.', []],
    ['Ajwain with warm water', 'अजवाइन', 'Relief from gas and indigestion', ['all'], ['½ tsp ajwain', 'pinch of black salt', 'warm water'], 'Chew ajwain with black salt and follow with warm water.', 'Gas, mild indigestion', 'Pain that is severe, persistent, or on the right side.', ['pregnan']],
    ['Saunf after meals', 'सौंफ', 'Freshens breath and aids digestion', ['summer', 'all'], ['1 tsp fennel seeds', 'optional: mishri'], 'Chew slowly after lunch and dinner.', 'After heavy meals', 'Ongoing acidity or heartburn more than twice a week.', []],
    ['Methi dana water', 'मेथी दाना पानी', 'Traditionally used to support healthy sugar levels', ['all'], ['1 tsp fenugreek seeds', '1 glass water'], 'Soak overnight, drink the water on an empty stomach and chew the seeds.', 'Morning routine', 'Any change to diabetes treatment must come from your doctor.', ['metformin', 'insulin', 'glimepiride', 'diabetes medicine']],
    ['Honey-lemon warm water', 'शहद-नींबू पानी', 'Gentle morning hydration', ['all'], ['1 glass warm water', '½ lemon', '1 tsp honey'], 'Mix and drink first thing in the morning.', 'Morning routine', 'Not a weight-loss treatment; see a doctor for unexplained weight change.', ['diabetes']],
    ['Nimbu-pani with a pinch of salt', 'नींबू पानी', 'Hydration in heat', ['summer'], ['1 glass water', '½ lemon', 'pinch of salt and sugar'], 'Mix and sip through the day in hot weather.', 'Heat, sweating, mild tiredness', 'Dizziness, confusion or very little urine — signs of heat illness.', ['kidney disease', 'hypertension']],
    ['Triphala at night', 'त्रिफला', 'Supports regular bowel movement', ['all'], ['1 tsp triphala powder', 'warm water'], 'Mix with warm water and take at bedtime.', 'Occasional constipation', 'Constipation over 2 weeks, blood in stool or weight loss.', ['pregnan', 'diarrhoea']],
    ['Steam with ajwain', 'अजवाइन की भाप', 'Opens a blocked nose', ['monsoon', 'winter'], ['1 tsp ajwain', 'bowl of hot water', 'towel'], 'Add ajwain to hot water and inhale steam for 5 minutes under a towel.', 'Blocked nose, sinus heaviness', 'Breathing difficulty, high fever, or symptoms over 10 days. Keep children away from hot water.', []],
    ['Sharad ritu cooling diet', 'शरद ऋतु आहार', 'Seasonal eating for the post-monsoon months', ['autumn'], ['amla', 'ghee in moderation', 'rice, moong dal', 'pomegranate'], 'Favour light, cooling foods; reduce fried, sour and very spicy dishes in October–November.', 'Seasonal routine (ritucharya)', 'Acidity or skin rashes that persist — consult a doctor.', []],
    ['Abhyanga (oil massage)', 'अभ्यंग', 'Daily self-massage for dry skin and relaxation', ['winter', 'autumn'], ['warm sesame or coconut oil'], 'Massage warm oil for 10 minutes before bathing.', 'Dry skin, stiffness, relaxation', 'Joint swelling, redness or pain — see a doctor.', ['eczema']],
    ['Amla', 'आंवला', 'Vitamin C-rich seasonal fruit', ['autumn', 'winter'], ['1 fresh amla or 2 tsp amla juice'], 'Eat one fresh amla daily or dilute juice in water.', 'Seasonal immunity routine', 'Not a treatment for infections; see a doctor if unwell.', []],
  ];
  REM.forEach((x, i) => {
    db.run('INSERT INTO remedies (id, title, hindi, goal, seasons, ingredients, method, when_to_use, see_doctor, avoid_if, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      `rmd_${i + 1}`, x[0], x[1], x[2], J(x[3]), J(x[4]), x[5], x[6], x[7], J(x[8]), 'Dr. Meera Kulkarni, BAMS',
    ]);
  });

  core.c.events.drain();
  return true;
}

module.exports = { seed };
