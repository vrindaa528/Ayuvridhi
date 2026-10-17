'use strict';
// consult: video consult session, doctor's signed e-prescription, follow-up.
// rx.issued fans out to records (timeline), reminders (dose schedules) and notify.

const { must, json, addMinutes, localDay } = require('../util');

// Starter templates the doctor can edit in the Provider Console.
const TEMPLATES = {
  'General Physician': {
    diagnosis: 'Type 2 diabetes mellitus — follow-up',
    notes: 'Sugar control improving. Continue diet and 30-min walk daily. Repeat HbA1c in 3 months.',
    items: [
      { drug: 'Metformin 500mg', dose: '1 tablet', frequency: '1-0-1', food: 'after food', days: 30 },
      { drug: 'Vitamin D3 60000 IU', dose: '1 sachet', frequency: 'weekly', food: 'after food', days: 56 },
    ],
    follow_up_days: 30,
  },
  Cardiologist: {
    diagnosis: 'Hypertension with dyslipidaemia',
    notes: 'BP 142/90. Reduce salt, daily walk. Lipid profile after 6 weeks.',
    items: [
      { drug: 'Amlodipine 5mg', dose: '1 tablet', frequency: '1-0-0', food: 'after food', days: 30 },
      { drug: 'Atorvastatin 10mg', dose: '1 tablet', frequency: '0-0-1', food: 'after food', days: 30 },
    ],
    follow_up_days: 42,
  },
  Pediatrician: {
    diagnosis: 'Upper respiratory tract infection (viral)',
    notes: 'Plenty of fluids, rest. Return if fever beyond 3 days or breathing difficulty.',
    items: [
      { drug: 'Paracetamol syrup 250mg/5ml', dose: '5 ml', frequency: 'sos', food: 'after food', days: 3 },
      { drug: 'Saline nasal drops', dose: '2 drops', frequency: '1-1-1', food: 'any time', days: 5 },
    ],
    follow_up_days: 5,
  },
  Endocrinologist: {
    diagnosis: 'Hypothyroidism',
    notes: 'Take on empty stomach, 30 minutes before breakfast. TSH after 6 weeks.',
    items: [{ drug: 'Levothyroxine 50mcg', dose: '1 tablet', frequency: '1-0-0', food: 'empty stomach', days: 42 }],
    follow_up_days: 42,
  },
  Dermatologist: {
    diagnosis: 'Contact dermatitis',
    notes: 'Avoid the trigger soap. Apply cream thin layer.',
    items: [
      { drug: 'Cetirizine 10mg', dose: '1 tablet', frequency: '0-0-1', food: 'after food', days: 7 },
      { drug: 'Mometasone cream 0.1%', dose: 'thin layer', frequency: '1-0-1', food: 'any time', days: 7 },
    ],
    follow_up_days: 7,
  },
};

function register(r, c) {
  const { db } = c;

  r.get('/api/consultations/templates', () => ({ items: TEMPLATES }));

  r.post('/api/consultations/:bookingId/start', ({ user, params }) => {
    const b = c._booking.get(params.bookingId);
    must(b, 404, 'Booking not found');
    c.consent.resolve(user, b.patient_id, 'appointments', 'start consult');
    must(b.provider_type === 'doctor', 400, 'Only doctor bookings have a consult room');
    must(['confirmed', 'checked_in', 'in_consult'].includes(b.status), 400, 'Wait for the clinic to confirm your booking');
    if (b.status !== 'in_consult') {
      c._booking.setStatus(b.id, 'in_consult');
      // VD-3: doctor sees the consented record for 72 h after the consult.
      c.consent.grantTemporary(b.patient_id, b.provider_id, ['reports', 'prescriptions', 'medicines'], 'consultation', 72 * 60);
      c.consent.log(b.provider_id, b.patient_id, 'reports', 'consultation');
    }
    const p = db.get('SELECT * FROM providers WHERE id = ?', [b.provider_id]);
    return {
      booking: c._booking.get(b.id),
      room: { id: `room_${b.id}`, provider: 'video adapter (100ms / Agora in production)' },
      doctor: { id: p.id, name: p.name, specialty: p.specialty, qualification: p.qualification, reg_no: p.reg_no },
      template: TEMPLATES[p.specialty] || TEMPLATES['General Physician'],
    };
  });

  // Doctor issues the e-prescription (Provider Console / doctor app).
  r.post('/api/provider/consultations/:bookingId/prescription', { roles: ['doctor'] }, ({ user, params, body, ip }) => {
    const b = c._booking.get(params.bookingId);
    must(b, 404, 'Booking not found');
    c.access.assertOwns(user, b.provider_id);
    c.audit(user, 'rx.issue', b.patient_id, ip, `booking ${b.id}`);
    must(['confirmed', 'checked_in', 'in_consult'].includes(b.status), 400, 'Consult is not active');
    const items = (body.items || []).filter((i) => i.drug);
    must(items.length, 400, 'Add at least one medicine');
    const now = c.now();
    const consultId = c.util.id('cst');
    const followUp = body.follow_up_days ? localDay(addMinutes(now, body.follow_up_days * 1440)) : null;
    db.run('INSERT INTO consultations (id, booking_id, doctor_id, patient_id, notes, follow_up_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      consultId,
      b.id,
      b.provider_id,
      b.patient_id,
      body.notes || '',
      followUp,
      now.toISOString(),
    ]);
    const rxId = c.util.id('rx');
    db.run('INSERT INTO prescriptions (id, consultation_id, patient_id, doctor_id, diagnosis, items, source, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      rxId,
      consultId,
      b.patient_id,
      b.provider_id,
      body.diagnosis || '',
      JSON.stringify(items),
      'e-prescription',
      now.toISOString(),
    ]);
    c._booking.setStatus(b.id, 'completed');
    c.api.release(b.txn_id);
    if (followUp) {
      db.run('INSERT INTO reminders (id, patient_id, kind, title, due_on, action) VALUES (?, ?, ?, ?, ?, ?)', [
        c.util.id('rem'),
        b.patient_id,
        'follow_up',
        `Follow-up with ${b.provider_name}`,
        followUp,
        `#/book?specialty=${encodeURIComponent(b.specialty || '')}`,
      ]);
    }
    c.events.emit('rx.issued', { prescription_id: rxId, patient_id: b.patient_id, booked_by: b.booked_by });
    return getRx(rxId);
  });

  r.get('/api/prescriptions', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'prescriptions', 'list prescriptions');
    const rows = db.all('SELECT id FROM prescriptions WHERE patient_id = ? ORDER BY issued_at DESC', [patientId]);
    return { items: rows.map((r0) => getRx(r0.id)) };
  });

  r.get('/api/prescriptions/:id', ({ user, params }) => {
    const rx = getRx(params.id);
    must(rx, 404, 'Prescription not found');
    c.consent.resolve(user, rx.patient_id, 'prescriptions', 'view prescription');
    return rx;
  });

  // Paper prescription photographed by the patient: stored, then verified by
  // the pharmacist when an order is placed against it.
  r.post('/api/prescriptions/upload', { rate: [{ by: 'user', name: 'upload', limit: 20, windowMs: 60 * 60000 }] }, ({ user, body }) => {
    const patientId = c.consent.resolve(user, body.member_id, 'prescriptions', 'upload prescription');
    const items = (body.items || []).filter((i) => i.drug);
    must(items.length, 400, 'List at least one medicine from the prescription');
    const rxId = c.util.id('rx');
    db.run('INSERT INTO prescriptions (id, patient_id, diagnosis, items, source, issued_at) VALUES (?, ?, ?, ?, ?, ?)', [
      rxId,
      patientId,
      body.doctor_name ? `Paper Rx — ${body.doctor_name}` : 'Paper prescription',
      JSON.stringify(items),
      'upload',
      c.now().toISOString(),
    ]);
    c.api.addRecord({
      patient_id: patientId,
      type: 'prescription',
      title: body.doctor_name ? `Prescription — ${body.doctor_name}` : 'Uploaded prescription',
      provider: body.doctor_name || 'Uploaded',
      date: localDay(c.now()),
      summary: items.map((i) => i.drug).join(', '),
      file_name: body.file_name || 'prescription.jpg',
      source: 'upload',
      ref_id: rxId,
    });
    return getRx(rxId);
  });

  function getRx(id) {
    const rx = db.get(
      `SELECT x.*, p.name AS doctor_name, p.specialty, p.qualification, p.reg_no, k.notes, k.follow_up_on, u.name AS patient_name
       FROM prescriptions x LEFT JOIN providers p ON p.id = x.doctor_id LEFT JOIN consultations k ON k.id = x.consultation_id
       JOIN users u ON u.id = x.patient_id WHERE x.id = ?`,
      [id]
    );
    if (!rx) return null;
    rx.items = json(rx.items, []);
    rx.signed = rx.source === 'e-prescription';
    rx.signature = rx.signed ? `sig:${(c.keyed(rx.id + rx.reg_no)).slice(0, 16)}` : null;
    return rx;
  }

  c._rx = { get: getRx };
}

function subscribe(c) {
  c.events.on('rx.issued', ({ prescription_id, patient_id, booked_by }) => {
    const rx = c._rx.get(prescription_id);
    c.api.addRecord({
      patient_id,
      type: 'prescription',
      title: `Prescription — ${rx.doctor_name}`,
      provider: rx.doctor_name,
      date: localDay(new Date(rx.issued_at)),
      summary: `${rx.diagnosis}. ${rx.items.map((i) => i.drug).join(', ')}`,
      file_name: `Rx_${rx.id}.pdf`,
      source: 'consult',
      ref_id: rx.id,
    });
    const to = new Set([patient_id, booked_by]);
    for (const uid of to) {
      if (!uid) continue;
      c.notify.send(uid, {
        kind: 'rx',
        title: 'Prescription ready — order in one tap',
        body: `${rx.doctor_name}: ${rx.items.length} medicine(s). Reminders set automatically.`,
        link: `#/rx/${rx.id}`,
      });
    }
  });
}

module.exports = { register, subscribe, TEMPLATES };
