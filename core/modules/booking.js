'use strict';
// booking: hold a live slot, pay upfront (held in escrow), provider confirms
// within 10 minutes or the booking auto-cancels with a full refund.

const { must, json, addMinutes } = require('../util');

const CONFIRM_WINDOW_MIN = 10;
const PLATFORM_FEE = 0; // "No hidden cost": anything charged is shown before booking

function register(r, c) {
  const { db } = c;

  function priceFor(p, slot, body) {
    let price = slot.price || p.fee || 0;
    let service = body.service || (p.type === 'doctor' ? `${p.specialty} consultation` : p.type === 'lab' ? 'Lab test' : 'OPD visit');
    let collection = 0;
    if (p.type === 'lab') {
      const tests = json(p.services, []);
      const chosen = tests.find((t) => t.name === body.service) || tests[0];
      if (chosen) {
        price = chosen.price;
        service = chosen.name;
      }
      if (body.mode === 'home') collection = 99;
    }
    return { price, collection, service, total: price + collection + PLATFORM_FEE };
  }

  r.post('/api/bookings/quote', ({ body }) => {
    const slot = db.get('SELECT * FROM slots WHERE id = ?', [body.slot_id]);
    must(slot, 404, 'Slot not found');
    const p = db.get('SELECT * FROM providers WHERE id = ?', [slot.provider_id]);
    const q = priceFor(p, slot, body);
    return Object.assign(q, { platform_fee: PLATFORM_FEE, discount: c.api.offerDiscount(body.offer_code, p.type === 'lab' ? 'lab' : 'consult', q.total) });
  });

  r.post('/api/bookings', ({ user, body }) => {
    const patientId = c.consent.resolve(user, body.member_id, 'appointments', 'booking');
    const now = c.now();
    const slot = db.get('SELECT * FROM slots WHERE id = ?', [body.slot_id]);
    must(slot, 404, 'Slot not found');
    must(slot.start_at > now.toISOString(), 400, 'This slot has already started');
    const free = slot.status === 'open' || (slot.status === 'held' && slot.hold_expires_at < now.toISOString());
    must(free, 409, 'Sorry, this slot was just taken. Please pick another.');
    const p = db.get('SELECT * FROM providers WHERE id = ?', [slot.provider_id]);
    must(p && p.verified_status === 'verified', 400, 'Provider is not verified');
    const mode = body.mode || (p.type === 'doctor' ? 'video' : p.type === 'lab' ? 'centre' : 'clinic');
    const q = priceFor(p, slot, Object.assign({}, body, { mode }));

    db.run("UPDATE slots SET status = 'held', hold_expires_at = ? WHERE id = ?", [addMinutes(now, CONFIRM_WINDOW_MIN).toISOString(), slot.id]);
    const id = c.util.id('bkg');
    const txn = c.api.charge({
      payer: user.id,
      member: patientId,
      category: p.type === 'lab' ? 'lab' : 'consult',
      ref_id: id,
      description: `${q.service} · ${p.name}`,
      amount: q.total,
      escrow: true,
      offer_code: body.offer_code,
    });
    db.run(
      'INSERT INTO bookings (id, patient_id, booked_by, provider_id, slot_id, type, mode, service, status, price, txn_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, patientId, user.id, p.id, slot.id, p.type, mode, q.service, 'requested', txn.amount, txn.id, now.toISOString(), now.toISOString()]
    );
    c.events.emit('booking.requested', { booking_id: id });
    return get(id);
  });

  r.get('/api/bookings', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'appointments', 'list bookings');
    const rows = db.all(
      `SELECT b.*, p.name AS provider_name, p.type AS provider_type, p.specialty, p.address, s.start_at
       FROM bookings b JOIN providers p ON p.id = b.provider_id LEFT JOIN slots s ON s.id = b.slot_id
       WHERE b.patient_id = ? ORDER BY s.start_at DESC LIMIT 50`,
      [patientId]
    );
    return { items: rows };
  });

  r.get('/api/bookings/:id', ({ user, params }) => {
    const b = get(params.id);
    must(b, 404, 'Booking not found');
    c.consent.resolve(user, b.patient_id, 'appointments', 'view booking');
    return b;
  });

  r.post('/api/bookings/:id/cancel', ({ user, params, body }) => {
    const b = get(params.id);
    must(b, 404, 'Booking not found');
    c.consent.resolve(user, b.patient_id, 'appointments', 'cancel booking');
    must(['requested', 'confirmed'].includes(b.status), 400, 'This booking can no longer be cancelled');
    const hoursBefore = (new Date(b.start_at) - c.now()) / 3600000;
    const refundPct = b.status === 'requested' || hoursBefore >= 2 ? 100 : 50;
    cancel(b, 'cancelled_by_patient', body.reason || 'Cancelled by patient', refundPct);
    return Object.assign(get(b.id), { refund_pct: refundPct });
  });

  r.post('/api/bookings/:id/checkin', ({ user, params }) => {
    const b = get(params.id);
    must(b, 404, 'Booking not found');
    must(b.patient_id === user.id || c.consent.can(user.id, b.patient_id, 'appointments'), 403, 'Not allowed');
    must(b.status === 'confirmed', 400, 'Only confirmed bookings can check in');
    setStatus(b.id, 'checked_in');
    db.run('UPDATE providers SET queue_len = queue_len + 1 WHERE id = ?', [b.provider_id]);
    return get(b.id);
  });

  // ---- Provider side (clinic / lab app). In production these routes require
  // a provider token; in the demo the Provider Console calls them.
  // Staff see only what their own provider records are involved in.
  r.get('/api/provider/queue', { roles: ['doctor', 'lab', 'clinic_staff', 'pharmacy', 'rider'] }, ({ user }) => {
    const providerIds = c.access.providerIds(user);
    const ph = (ids) => ids.map(() => '?').join(',') || "''";
    const bookings = providerIds.length
      ? db.all(
          `SELECT b.*, p.name AS provider_name, p.type AS provider_type, u.name AS patient_name, s.start_at
           FROM bookings b JOIN providers p ON p.id = b.provider_id JOIN users u ON u.id = b.patient_id LEFT JOIN slots s ON s.id = b.slot_id
           WHERE b.provider_id IN (${ph(providerIds)}) AND b.status IN ('requested','confirmed','checked_in','in_consult') ORDER BY b.created_at DESC LIMIT 30`,
          providerIds
        )
      : [];
    const orders = providerIds.length
      ? db.all(
          `SELECT o.*, p.name AS pharmacy_name, u.name AS patient_name FROM orders o JOIN providers p ON p.id = o.pharmacy_id JOIN users u ON u.id = o.patient_id
           WHERE o.pharmacy_id IN (${ph(providerIds)}) AND o.status IN ('placed','substitution_pending','verified','dispatched','arrived') ORDER BY o.created_at DESC LIMIT 30`,
          providerIds
        )
      : [];
    return {
      bookings,
      orders: orders.map((o) => Object.assign(o, { items: json(o.items, []), otp_hash: undefined })),
    };
  });

  function ownBooking(user, id) {
    const b = get(id);
    must(b, 404, 'Booking not found');
    c.access.assertOwns(user, b.provider_id);
    return b;
  }

  r.post('/api/provider/bookings/:id/confirm', { roles: ['doctor', 'lab', 'clinic_staff'] }, ({ user, params, ip }) => {
    const b = ownBooking(user, params.id);
    must(b.status === 'requested', 400, 'Booking is not awaiting confirmation');
    confirm(b);
    c.audit(user, 'booking.confirm', b.patient_id, ip, `booking ${b.id}`);
    return get(b.id);
  });

  r.post('/api/provider/bookings/:id/reject', { roles: ['doctor', 'lab', 'clinic_staff'] }, ({ user, params, body, ip }) => {
    const b = ownBooking(user, params.id);
    must(b.status === 'requested', 400, 'Booking is not awaiting confirmation');
    cancel(b, 'cancelled_by_provider', body.reason || 'Provider unavailable', 100);
    c.audit(user, 'booking.reject', b.patient_id, ip, `booking ${b.id}`);
    return get(b.id);
  });

  // Lab uploads the report → lands in the patient's records with values.
  r.post('/api/provider/bookings/:id/report', { roles: ['lab'] }, ({ user, params, body, ip }) => {
    const b = ownBooking(user, params.id);
    must(b.provider_type === 'lab', 400, 'Only lab bookings take reports');
    c.audit(user, 'lab.report', b.patient_id, ip, `booking ${b.id}`);
    must(['confirmed', 'checked_in', 'in_consult'].includes(b.status), 400, 'Sample not collected yet');
    setStatus(b.id, 'completed');
    c.api.release(b.txn_id);
    const values = body.values && body.values.length ? body.values : defaultLabValues(b.service);
    c.api.addRecord({
      patient_id: b.patient_id,
      type: 'lab_report',
      title: b.service,
      provider: b.provider_name,
      date: c.util.localDay(c.now()),
      summary: values.map((v) => `${v.test}: ${v.value} ${v.unit}`).join(' · '),
      file_name: `${b.service.replace(/\W+/g, '_')}.pdf`,
      source: 'partner_lab',
      ref_id: b.id,
      values,
    });
    c.notify.send(b.patient_id, { kind: 'record', title: 'Your lab report is ready', body: `${b.service} from ${b.provider_name}`, link: '#/records' });
    return get(b.id);
  });

  function defaultLabValues(service) {
    const s = (service || '').toLowerCase();
    if (s.includes('hba1c') || s.includes('diabet')) return [{ test: 'HbA1c', value: 6.9, unit: '%', ref_range: '< 5.7' }];
    if (s.includes('lipid')) return [
      { test: 'LDL cholesterol', value: 118, unit: 'mg/dL', ref_range: '< 100' },
      { test: 'HDL cholesterol', value: 46, unit: 'mg/dL', ref_range: '> 40' },
      { test: 'Triglycerides', value: 162, unit: 'mg/dL', ref_range: '< 150' },
    ];
    if (s.includes('thyroid')) return [{ test: 'TSH', value: 2.8, unit: 'mIU/L', ref_range: '0.4–4.0' }];
    return [
      { test: 'Haemoglobin', value: 13.4, unit: 'g/dL', ref_range: '12–16' },
      { test: 'WBC count', value: 7200, unit: '/µL', ref_range: '4000–11000' },
      { test: 'Platelets', value: 2.6, unit: 'lakh/µL', ref_range: '1.5–4.5' },
    ];
  }

  function get(id) {
    const b = db.get(
      `SELECT b.*, p.name AS provider_name, p.type AS provider_type, p.specialty, p.address, p.lat, p.lng, s.start_at, s.end_at, u.name AS patient_name
       FROM bookings b JOIN providers p ON p.id = b.provider_id LEFT JOIN slots s ON s.id = b.slot_id JOIN users u ON u.id = b.patient_id WHERE b.id = ?`,
      [id]
    );
    if (b && b.status === 'requested') {
      b.confirm_by = addMinutes(new Date(b.created_at), CONFIRM_WINDOW_MIN).toISOString();
    }
    return b;
  }

  function setStatus(id, status) {
    db.run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?', [status, c.now().toISOString(), id]);
  }

  function confirm(b) {
    const n = db.get("SELECT COUNT(*) AS n FROM bookings WHERE provider_id = ? AND status IN ('confirmed','checked_in','in_consult','completed')", [b.provider_id]).n;
    const token = `${b.provider_type === 'lab' ? 'L' : 'A'}-${String(n + 1).padStart(2, '0')}`;
    db.run('UPDATE bookings SET status = ?, token_no = ?, updated_at = ? WHERE id = ?', ['confirmed', token, c.now().toISOString(), b.id]);
    db.run("UPDATE slots SET status = 'booked', hold_expires_at = NULL WHERE id = ?", [b.slot_id]);
    c.events.emit('booking.confirmed', { booking_id: b.id });
    const when = new Date(b.start_at);
    const notifyIds = [b.booked_by].concat(b.booked_by === b.patient_id ? [] : [b.patient_id]);
    for (const uid of notifyIds) {
      c.notify.send(uid, {
        kind: 'booking',
        title: 'Booking confirmed',
        body: `${b.service} with ${b.provider_name}, token ${token}`,
        link: `#/booking/${b.id}`,
        channels: ['push', 'sms'],
      });
    }
    // Upcoming-care reminder on the day.
    c.db.run('INSERT INTO reminders (id, patient_id, kind, title, due_on, action) VALUES (?, ?, ?, ?, ?, ?)', [
      c.util.id('rem'),
      b.patient_id,
      'appointment',
      `${b.service} · ${b.provider_name} at ${when.toTimeString().slice(0, 5)}`,
      c.util.localDay(when),
      `#/booking/${b.id}`,
    ]);
  }

  function cancel(b, status, reason, refundPct) {
    setStatus(b.id, status);
    db.run("UPDATE slots SET status = 'open', hold_expires_at = NULL WHERE id = ?", [b.slot_id]);
    db.run("UPDATE reminders SET done = 1 WHERE action = ?", [`#/booking/${b.id}`]);
    if (b.txn_id) c.api.refund(b.txn_id, Math.round((b.price * refundPct) / 100), reason);
    c.events.emit('booking.cancelled', { booking_id: b.id, status });
    c.notify.send(b.booked_by, {
      kind: 'booking',
      title: status === 'cancelled_by_provider' ? 'Clinic could not confirm — full refund issued' : 'Booking cancelled',
      body: `${b.service} with ${b.provider_name}. Refund ${refundPct}% initiated.`,
      link: '#/wallet',
    });
  }

  r._booking = { get, confirm, cancel, setStatus };
  c._booking = r._booking;
}

// Auto-cancel bookings the provider did not confirm in time; in the demo,
// clinics auto-confirm after a few seconds so a lone user sees the flow.
function tick(c) {
  const now = c.now();
  const pending = c.db.all("SELECT id, created_at FROM bookings WHERE status = 'requested'", []);
  for (const p of pending) {
    const b = c._booking.get(p.id);
    const ageSec = (now - new Date(b.created_at)) / 1000;
    if (c.deps.autoConfirmSeconds && ageSec >= c.deps.autoConfirmSeconds) c._booking.confirm(b);
    else if (ageSec >= CONFIRM_WINDOW_MIN * 60) c._booking.cancel(b, 'cancelled_by_provider', 'Not confirmed in time', 100);
  }
  // Past appointments that nobody closed become no-shows / completed.
  const stale = c.db.all(
    "SELECT b.id, b.status, s.end_at FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.status IN ('confirmed','checked_in') AND s.end_at < ?",
    [addMinutes(now, -180).toISOString()]
  );
  for (const s of stale) c._booking.setStatus(s.id, s.status === 'confirmed' ? 'no_show' : 'completed');
}

module.exports = { register, tick, CONFIRM_WINDOW_MIN };
