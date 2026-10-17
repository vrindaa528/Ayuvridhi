'use strict';
// pharmacy + delivery: Order from Rx → pharmacist verification (consented
// substitution only) → dispatch with live tracking → OTP handover → patient
// confirmation releases the escrowed payment.

const { must, json, haversineKm, travelMinutes, addMinutes, localDay, safeEqual } = require('../util');

// Delivery OTP: 4 digits derived from a server-held key, the order id and the
// dispatch time. Nothing that reveals the code is stored: the database keeps
// only a keyed hash for checking, and the patient view re-derives the code
// while the delivery is live (see getOrder).
const HANDOVER_TTL_MIN = 12 * 60;
function handoverCode(c, orderId, dispatchedAt) {
  const h = c.keyed(`handover|${orderId}|${dispatchedAt}`);
  return String(1000 + (parseInt(h.slice(0, 8), 16) % 9000));
}
const handoverCheck = (c, orderId, code) => c.keyed(`handover-check|${orderId}|${code}`);

// Drug master. rx: prescription required. unit price in ₹ (MRP basis).
const DRUGS = {
  'Metformin 500mg': { rx: true, unit: 'tablet', mrp: 2.1 },
  'Atorvastatin 10mg': { rx: true, unit: 'tablet', mrp: 6.5 },
  'Amlodipine 5mg': { rx: true, unit: 'tablet', mrp: 3.2 },
  'Telmisartan 40mg': { rx: true, unit: 'tablet', mrp: 7.4 },
  'Levothyroxine 50mcg': { rx: true, unit: 'tablet', mrp: 1.6 },
  'Cetirizine 10mg': { rx: false, unit: 'tablet', mrp: 1.8 },
  'Mometasone cream 0.1%': { rx: true, unit: 'tube', mrp: 168 },
  'Paracetamol 650mg': { rx: false, unit: 'tablet', mrp: 2.0 },
  'Paracetamol syrup 250mg/5ml': { rx: false, unit: 'bottle', mrp: 46 },
  'Saline nasal drops': { rx: false, unit: 'bottle', mrp: 58 },
  'Vitamin D3 60000 IU': { rx: false, unit: 'sachet', mrp: 32 },
  'Multivitamin Complex': { rx: false, unit: 'tablet', mrp: 5.5 },
  'ORS sachet': { rx: false, unit: 'sachet', mrp: 21 },
  'Digital thermometer': { rx: false, unit: 'piece', mrp: 249 },
  'BP monitor (upper arm)': { rx: false, unit: 'piece', mrp: 1899 },
  'Glucometer strips (50)': { rx: false, unit: 'box', mrp: 899 },
};

function perDay(freq) {
  if (!freq) return 1;
  if (/weekly/i.test(freq)) return 1 / 7;
  if (/sos/i.test(freq)) return 1;
  return String(freq)
    .split('-')
    .map((x) => parseFloat(x) || 0)
    .reduce((a, b) => a + b, 0) || 1;
}

function qtyFor(item) {
  const d = DRUGS[item.drug];
  if (d && !['tablet', 'sachet'].includes(d.unit)) return 1;
  if (item.qty) return item.qty;
  return Math.min(90, Math.max(1, Math.ceil(perDay(item.frequency) * (item.days || 1))));
}

function register(r, c) {
  const { db } = c;

  function patientLoc(patientId, user) {
    const p = db.get('SELECT lat, lng FROM users WHERE id = ?', [patientId]);
    return { lat: (p && p.lat) || user.lat || 19.076, lng: (p && p.lng) || user.lng || 72.8777 };
  }

  function quote(pharmacy, items, loc) {
    const lines = items.map((it) => {
      const s = db.get('SELECT * FROM stock WHERE pharmacy_id = ? AND drug = ?', [pharmacy.id, it.drug]);
      const qty = qtyFor(it);
      const available = !!(s && s.qty >= qty);
      return { drug: it.drug, qty, unit: (DRUGS[it.drug] || {}).unit || 'unit', unit_price: s ? s.price : null, available, line_total: available ? Math.round(s.price * qty) : 0 };
    });
    const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
    const km = Math.round(haversineKm(loc.lat, loc.lng, pharmacy.lat, pharmacy.lng) * 10) / 10;
    const deliveryFee = subtotal >= 499 ? 0 : 30;
    const ageMin = (c.now() - new Date(pharmacy.availability_updated_at || 0)) / 60000;
    return {
      pharmacy: { id: pharmacy.id, name: pharmacy.name, address: pharmacy.address, rating: pharmacy.rating, accreditation: pharmacy.accreditation },
      lines,
      all_available: lines.every((l) => l.available),
      missing: lines.filter((l) => !l.available).map((l) => l.drug),
      subtotal,
      delivery_fee: deliveryFee,
      total: subtotal + deliveryFee,
      distance_km: km,
      eta_min: 15 + travelMinutes(km),
      stock_freshness: ageMin <= 15 ? 'live' : 'unconfirmed',
      price_locked_min: 15,
    };
  }

  r.get('/api/prescriptions/:id/pharmacies', ({ user, params }) => {
    const rx = c._rx.get(params.id);
    must(rx, 404, 'Prescription not found');
    c.consent.resolve(user, rx.patient_id, 'prescriptions', 'order from prescription');
    const loc = patientLoc(rx.patient_id, user);
    const options = c.api
      .nearest('pharmacy', loc.lat, loc.lng)
      .filter((p) => p.distance_km <= 10)
      .map((p) => quote(p, rx.items, loc))
      .sort((a, b) => (a.all_available === b.all_available ? a.eta_min - b.eta_min : a.all_available ? -1 : 1));
    return { prescription: rx, options };
  });

  r.get('/api/store', ({ user, query }) => {
    const loc = { lat: user.lat || 19.076, lng: user.lng || 72.8777 };
    const nearby = c.api.nearest('pharmacy', loc.lat, loc.lng).filter((p) => p.distance_km <= 10);
    const items = Object.keys(DRUGS)
      .filter((d) => !query.q || d.toLowerCase().includes(query.q.toLowerCase()))
      .map((drug) => {
        const offers = nearby
          .map((p) => ({ p, s: db.get('SELECT * FROM stock WHERE pharmacy_id = ? AND drug = ? AND qty > 0', [p.id, drug]) }))
          .filter((x) => x.s);
        const best = offers.sort((a, b) => a.s.price - b.s.price)[0];
        return {
          drug,
          rx_required: DRUGS[drug].rx,
          unit: DRUGS[drug].unit,
          mrp: DRUGS[drug].mrp,
          best_price: best ? best.s.price : null,
          pharmacy_id: best ? best.p.id : null,
          pharmacy_name: best ? best.p.name : null,
          in_stock_at: offers.length,
        };
      });
    return { items };
  });

  r.post('/api/orders', ({ user, body }) => {
    let patientId;
    let items;
    let rx = null;
    if (body.prescription_id) {
      rx = c._rx.get(body.prescription_id);
      must(rx, 404, 'Prescription not found');
      patientId = c.consent.resolve(user, rx.patient_id, 'prescriptions', 'order from prescription');
      items = rx.items;
    } else {
      patientId = c.consent.resolve(user, body.member_id, 'medicines', 'store order');
      items = (body.items || []).filter((i) => i.drug && i.qty > 0);
      must(items.length, 400, 'Your cart is empty');
      const rxOnly = items.filter((i) => !DRUGS[i.drug] || DRUGS[i.drug].rx);
      must(!rxOnly.length, 400, `${rxOnly.map((i) => i.drug).join(', ')} needs a prescription. Order it from your prescription instead.`);
    }
    const pharmacy = db.get("SELECT * FROM providers WHERE id = ? AND type = 'pharmacy' AND verified_status = 'verified'", [body.pharmacy_id]);
    must(pharmacy, 400, 'Choose a verified pharmacy');
    const loc = patientLoc(patientId, user);
    const q = quote(pharmacy, items, loc);
    if (!q.all_available) must(body.allow_partial, 409, `Not in stock here: ${q.missing.join(', ')}`);
    const lines = q.lines.filter((l) => l.available);
    must(lines.length, 409, 'Nothing from this order is in stock here');

    const now = c.now();
    const id = c.util.id('ord');
    for (const l of lines) db.run('UPDATE stock SET qty = qty - ? WHERE pharmacy_id = ? AND drug = ?', [l.qty, pharmacy.id, l.drug]);
    const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
    const deliveryFee = subtotal >= 499 ? 0 : 30;
    const txn = c.api.charge({
      payer: user.id,
      member: patientId,
      category: 'pharmacy',
      ref_id: id,
      description: `${rx ? 'Rx order' : 'Store order'} · ${pharmacy.name}`,
      amount: subtotal + deliveryFee,
      escrow: true,
      offer_code: body.offer_code,
    });
    db.run(
      'INSERT INTO orders (id, patient_id, placed_by, pharmacy_id, prescription_id, items, status, subtotal, delivery_fee, total, txn_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, patientId, user.id, pharmacy.id, rx ? rx.id : null, JSON.stringify(lines), 'placed', subtotal, deliveryFee, txn.amount, txn.id, now.toISOString(), now.toISOString()]
    );
    db.run('INSERT INTO deliveries (order_id, status, from_lat, from_lng, to_lat, to_lng) VALUES (?, ?, ?, ?, ?, ?)', [id, 'pending', pharmacy.lat, pharmacy.lng, loc.lat, loc.lng]);
    c.events.emit('order.placed', { order_id: id });
    return getOrder(id, true);
  });

  r.get('/api/orders', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'medicines', 'list orders');
    return { items: db.all('SELECT id FROM orders WHERE patient_id = ? ORDER BY created_at DESC LIMIT 30', [patientId]).map((o) => getOrder(o.id, true)) };
  });

  r.get('/api/orders/:id', ({ user, params }) => {
    const o = getOrder(params.id, true);
    must(o, 404, 'Order not found');
    c.consent.resolve(user, o.patient_id, 'medicines', 'track order');
    return o;
  });

  r.post('/api/orders/:id/cancel', ({ user, params }) => {
    const o = getOrder(params.id);
    must(o, 404, 'Order not found');
    c.consent.resolve(user, o.patient_id, 'medicines', 'cancel order');
    must(['placed', 'substitution_pending', 'verified'].includes(o.status), 400, 'The order is already on its way');
    cancelOrder(o, 'Cancelled by patient');
    return getOrder(o.id, true);
  });

  r.post('/api/orders/:id/substitution', ({ user, params, body }) => {
    const o = getOrder(params.id);
    must(o && o.status === 'substitution_pending', 400, 'No substitution awaiting your approval');
    c.consent.resolve(user, o.patient_id, 'medicines', 'approve substitution');
    const sub = o.substitution;
    let items = o.items;
    let diff = 0;
    if (body.approve) {
      items = items.map((l) => {
        if (l.drug !== sub.from) return l;
        const total = Math.round(sub.unit_price * l.qty);
        diff = total - l.line_total;
        return Object.assign({}, l, { drug: sub.to, unit_price: sub.unit_price, line_total: total, substituted_from: sub.from });
      });
    } else {
      const removed = items.find((l) => l.drug === sub.from);
      items = items.filter((l) => l.drug !== sub.from);
      diff = removed ? -removed.line_total : 0;
    }
    if (!items.length) {
      cancelOrder(o, 'Substitute declined');
      return getOrder(o.id, true);
    }
    const subtotal = o.subtotal + diff;
    if (diff < 0) c.api.refund(o.txn_id, -diff, body.approve ? 'Cheaper substitute' : 'Item removed');
    if (diff > 0) c.api.charge({ payer: user.id, member: o.patient_id, category: 'pharmacy', ref_id: o.id, description: `Substitute price difference · ${o.pharmacy_name}`, amount: diff, escrow: true });
    db.run("UPDATE orders SET items = ?, subtotal = ?, total = ?, status = 'verified', substitution = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(items),
      subtotal,
      subtotal + o.delivery_fee,
      JSON.stringify(Object.assign({}, sub, { decision: body.approve ? 'approved' : 'declined' })),
      c.now().toISOString(),
      o.id,
    ]);
    return getOrder(o.id, true);
  });

  // ---- Pharmacy and delivery-partner side (Provider Console in the demo).
  // Pharmacy staff act only on orders their pharmacy received.
  r.post('/api/provider/orders/:id/verify', { roles: ['pharmacy'] }, ({ user, params, body, ip }) => {
    const o = getOrder(params.id);
    must(o, 404, 'Order not found');
    c.access.assertOwns(user, o.pharmacy_id);
    must(o.status === 'placed', 400, 'Order is not awaiting verification');
    verify(o, body.substitute);
    c.audit(user, 'order.verify', o.patient_id, ip, `order ${o.id}${body.substitute ? ' (substitute suggested)' : ''}`);
    return getOrder(o.id);
  });

  r.post('/api/provider/orders/:id/dispatch', { roles: ['pharmacy'] }, ({ user, params, ip }) => {
    const o = getOrder(params.id);
    must(o, 404, 'Order not found');
    c.access.assertOwns(user, o.pharmacy_id);
    must(o.status === 'verified', 400, 'Verify the order before dispatch');
    dispatch(o);
    c.audit(user, 'order.dispatch', o.patient_id, ip, `order ${o.id}`);
    return getOrder(o.id);
  });

  // A rider linked to the pharmacy (or the pharmacy itself) hands the order over.
  r.post('/api/provider/orders/:id/handover', { roles: ['rider', 'pharmacy'] }, ({ user, params, body, ip }) => {
    const o = getOrder(params.id);
    must(o, 404, 'Order not found');
    c.access.assertOwns(user, o.pharmacy_id);
    must(['dispatched', 'arrived'].includes(o.status), 400, 'Order is not out for delivery');
    const d = db.get('SELECT * FROM deliveries WHERE order_id = ?', [o.id]);
    must(d.otp_attempts < 3, 423, 'Handover blocked after 3 wrong OTPs. Ops team alerted.');
    const stored = db.get('SELECT otp_hash FROM orders WHERE id = ?', [o.id]).otp_hash;
    const ok = !!stored && safeEqual(handoverCheck(c, o.id, String(body.otp || '')), stored);
    if (!ok) {
      db.run('UPDATE deliveries SET otp_attempts = otp_attempts + 1 WHERE order_id = ?', [o.id]);
      if (d.otp_attempts + 1 >= 3) {
        db.run("UPDATE deliveries SET status = 'blocked' WHERE order_id = ?", [o.id]);
        c.log('ops', `Order ${o.id}: handover blocked after 3 wrong OTPs`);
        c.audit(user, 'handover.blocked', o.patient_id, ip, `order ${o.id}`);
      }
      c.audit(user, 'handover.wrong_otp', o.patient_id, ip, `order ${o.id}`);
      must(false, 400, `Wrong OTP (${2 - d.otp_attempts} attempt(s) left)`);
    }
    const now = c.now().toISOString();
    db.run("UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ?", [now, o.id]);
    db.run("UPDATE deliveries SET status = 'delivered' WHERE order_id = ?", [o.id]);
    c.audit(user, 'handover.delivered', o.patient_id, ip, `order ${o.id}`);
    c.events.emit('order.delivered', { order_id: o.id });
    return getOrder(o.id, true);
  });

  // MS-8: patient confirms receipt → escrow released to the pharmacy.
  r.post('/api/orders/:id/confirm-receipt', ({ user, params }) => {
    const o = getOrder(params.id);
    must(o && o.status === 'delivered', 400, 'Order not delivered yet');
    c.consent.resolve(user, o.patient_id, 'medicines', 'confirm receipt');
    c.api.release(o.txn_id);
    db.run("UPDATE orders SET status = 'completed', updated_at = ? WHERE id = ?", [c.now().toISOString(), o.id]);
    return getOrder(o.id, true);
  });

  function verify(o, substitute) {
    const now = c.now().toISOString();
    if (substitute && substitute.from && substitute.to) {
      db.run("UPDATE orders SET status = 'substitution_pending', substitution = ?, updated_at = ? WHERE id = ?", [JSON.stringify(substitute), now, o.id]);
      c.notify.send(o.placed_by, {
        kind: 'order',
        title: 'Pharmacist suggests a substitute — your approval needed',
        body: `${substitute.from} → ${substitute.to} at ₹${substitute.unit_price}/unit`,
        link: `#/order/${o.id}`,
      });
      return;
    }
    db.run("UPDATE orders SET status = 'verified', updated_at = ? WHERE id = ?", [now, o.id]);
    c.notify.send(o.placed_by, { kind: 'order', title: 'Prescription verified by pharmacist', body: `${o.pharmacy_name} is packing your order`, link: `#/order/${o.id}` });
  }

  function dispatch(o) {
    const now = c.now();
    const d = db.get('SELECT * FROM deliveries WHERE order_id = ?', [o.id]);
    const km = haversineKm(d.from_lat, d.from_lng, d.to_lat, d.to_lng);
    let eta = travelMinutes(km);
    if (c.deps.maxDemoEtaMin) eta = Math.min(eta, c.deps.maxDemoEtaMin);
    const dispatchedAt = now.toISOString();
    const otp = handoverCode(c, o.id, dispatchedAt);
    const partners = ['Ravi S.', 'Imran K.', 'Sandeep P.', 'Mahesh T.'];
    db.run("UPDATE orders SET status = 'dispatched', otp_hash = ?, updated_at = ? WHERE id = ?", [handoverCheck(c, o.id, otp), dispatchedAt, o.id]);
    db.run("UPDATE deliveries SET status = 'on_the_way', partner = ?, dispatched_at = ?, eta_at = ? WHERE order_id = ?", [
      partners[Math.floor(Math.random() * partners.length)],
      dispatchedAt,
      addMinutes(now, eta).toISOString(),
      o.id,
    ]);
    // The notification never carries the code: notifications are stored rows.
    c.notify.send(o.placed_by, {
      kind: 'order',
      title: `Out for delivery — arriving in ${eta} min`,
      body: 'Open your order to see the delivery code. Share it only with the delivery partner at your door.',
      link: `#/order/${o.id}`,
      channels: ['push', 'sms'],
    });
  }

  function cancelOrder(o, reason) {
    for (const l of o.items) db.run('UPDATE stock SET qty = qty + ? WHERE pharmacy_id = ? AND drug = ?', [l.qty, o.pharmacy_id, l.drug]);
    db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", [c.now().toISOString(), o.id]);
    db.run("UPDATE deliveries SET status = 'cancelled' WHERE order_id = ?", [o.id]);
    c.api.refund(o.txn_id, null, reason);
  }

  function getOrder(id, forPatient) {
    const o = db.get(
      `SELECT o.*, p.name AS pharmacy_name, p.address AS pharmacy_address, u.name AS patient_name
       FROM orders o JOIN providers p ON p.id = o.pharmacy_id JOIN users u ON u.id = o.patient_id WHERE o.id = ?`,
      [id]
    );
    if (!o) return null;
    o.items = json(o.items, []);
    o.substitution = json(o.substitution, null);
    const d = db.get('SELECT * FROM deliveries WHERE order_id = ?', [id]);
    if (d) {
      let progress = 0;
      if (d.dispatched_at && d.eta_at) {
        const total = new Date(d.eta_at) - new Date(d.dispatched_at);
        progress = Math.max(0, Math.min(1, (c.now() - new Date(d.dispatched_at)) / (total || 1)));
      }
      if (['delivered'].includes(d.status)) progress = 1;
      o.delivery = {
        status: d.status,
        partner: d.partner,
        eta_at: d.eta_at,
        eta_min_left: d.eta_at ? Math.max(0, Math.ceil((new Date(d.eta_at) - c.now()) / 60000)) : null,
        progress,
        from: { lat: d.from_lat, lng: d.from_lng },
        to: { lat: d.to_lat, lng: d.to_lng },
        current: { lat: d.from_lat + (d.to_lat - d.from_lat) * progress, lng: d.from_lng + (d.to_lng - d.from_lng) * progress },
        otp_attempts: d.otp_attempts,
      };
    }
    // The patient sees the delivery code in-app while the delivery is live
    // (derived on demand, never stored). Provider views never get it.
    delete o.otp_hash;
    o.otp = undefined;
    if (forPatient && d && d.dispatched_at && ['dispatched', 'arrived'].includes(o.status)) {
      const ageMin = (c.now() - new Date(d.dispatched_at)) / 60000;
      if (ageMin <= HANDOVER_TTL_MIN) o.otp = handoverCode(c, o.id, d.dispatched_at);
    }
    o.steps = [
      { key: 'placed', label: 'Order placed · payment held safely' },
      { key: 'verified', label: 'Prescription verified by pharmacist' },
      { key: 'dispatched', label: 'Out for delivery' },
      { key: 'delivered', label: 'Delivered with OTP' },
      { key: 'completed', label: 'Receipt confirmed · payment released' },
    ];
    return o;
  }

  c._orders = { getOrder, verify, dispatch };
}

function subscribe(c) {
  c.events.on('order.placed', ({ order_id }) => {
    const o = c._orders.getOrder(order_id);
    c.notify.send(o.placed_by, { kind: 'order', title: 'Order placed', body: `${o.pharmacy_name} will verify your prescription shortly.`, link: `#/order/${o.id}` });
  });
  c.events.on('order.delivered', ({ order_id }) => {
    const o = c._orders.getOrder(order_id);
    c.api.addRecord({
      patient_id: o.patient_id,
      type: 'medicine',
      title: `Medicines delivered · ${o.pharmacy_name}`,
      provider: o.pharmacy_name,
      date: localDay(c.now()),
      summary: o.items.map((i) => `${i.drug} × ${i.qty}`).join(', '),
      source: 'pharmacy',
      ref_id: o.id,
    });
    for (const it of o.items) {
      c.db.run('UPDATE schedules SET stock_left = COALESCE(stock_left, 0) + ? WHERE patient_id = ? AND drug = ? AND active = 1', [it.qty, o.patient_id, it.drug]);
    }
    c.db.run("UPDATE reminders SET done = 1 WHERE patient_id = ? AND kind = 'refill'", [o.patient_id]);
    c.notify.send(o.placed_by, { kind: 'order', title: 'Delivered — please confirm receipt', body: 'Confirming releases the payment to the pharmacy.', link: `#/order/${o.id}` });
  });
}

function tick(c) {
  const now = c.now();
  // Demo autopilot: pharmacist verifies and dispatches after a few seconds.
  if (c.deps.autoConfirmSeconds) {
    for (const o of c.db.all("SELECT id, updated_at, status FROM orders WHERE status IN ('placed','verified')", [])) {
      if ((now - new Date(o.updated_at)) / 1000 < c.deps.autoConfirmSeconds) continue;
      const full = c._orders.getOrder(o.id);
      if (o.status === 'placed') c._orders.verify(full);
      else c._orders.dispatch(full);
    }
  }
  for (const d of c.db.all("SELECT order_id FROM deliveries WHERE status = 'on_the_way' AND eta_at <= ?", [now.toISOString()])) {
    c.db.run("UPDATE deliveries SET status = 'arrived' WHERE order_id = ?", [d.order_id]);
    c.db.run("UPDATE orders SET status = 'arrived', updated_at = ? WHERE id = ?", [now.toISOString(), d.order_id]);
    const o = c._orders.getOrder(d.order_id);
    c.notify.send(o.placed_by, { kind: 'order', title: 'Delivery partner is at your door', body: 'Share the OTP shown in the app to receive your medicines.', link: `#/order/${o.id}` });
  }
  // Auto-release escrow 48 h after delivery if the patient did not dispute.
  for (const o of c.db.all("SELECT id, txn_id FROM orders WHERE status = 'delivered' AND updated_at <= ?", [addMinutes(now, -48 * 60).toISOString()])) {
    c.api.release(o.txn_id);
    c.db.run("UPDATE orders SET status = 'completed' WHERE id = ?", [o.id]);
  }
}

module.exports = { register, subscribe, tick, DRUGS, qtyFor, perDay };
