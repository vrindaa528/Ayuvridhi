'use strict';
// End-to-end flows through core.handle() on an in-memory database.
// Run: npm test

process.env.TZ = 'Asia/Kolkata';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createCore } = require('../core/app');
const { seed } = require('../core/seed');
const { openDb } = require('../server/db-node');

let clock = new Date();
function makeCore() {
  clock = new Date();
  const core = createCore({
    db: openDb(':memory:'),
    now: () => new Date(clock),
    sign: (p) => Buffer.from(JSON.stringify(p)).toString('base64'),
    verify: (t) => {
      try {
        return JSON.parse(Buffer.from(t, 'base64').toString());
      } catch (e) {
        return null;
      }
    },
    hash: (s) => crypto.createHash('sha256').update(`otp:${s}`).digest('hex'),
    demoOtp: '123456',
    autoConfirmSeconds: 0,
  });
  seed(core);
  return core;
}
const advance = (min) => (clock = new Date(clock.getTime() + min * 60000));

function client(core) {
  let token = null;
  const call = (method, url, body) => {
    const out = core.handle(method, url, body, token ? { authorization: `Bearer ${token}` } : {});
    if (out.status >= 400) {
      const e = new Error(`${method} ${url} → ${out.status} ${out.body.error}`);
      e.status = out.status;
      throw e;
    }
    return out.body;
  };
  return {
    login(phone, name) {
      call('POST', '/api/auth/otp/request', { phone });
      token = call('POST', '/api/auth/otp/verify', { phone, code: '123456', name }).token;
      return this;
    },
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    put: (u, b) => call('PUT', u, b),
  };
}

test('login, profile, dashboard with family alerts', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const me = raj.get('/api/me');
  assert.equal(me.user.name, 'Rajesh Kumar');
  assert.equal(me.family.role, 'leader');
  const dash = raj.get('/api/dashboard');
  assert.ok(dash.doses.length >= 1);
  assert.ok(dash.alerts.some((a) => a.kind === 'missed_dose' && a.member === 'Kamla Devi'), 'missed dose for Kamla escalated');
  const notes = raj.get('/api/notifications').items;
  assert.ok(notes.some((n) => n.kind === 'missed_dose'), 'leader notified of missed dose');
  assert.throws(() => client(core).get('/api/me'), /401/);
});

test('consent blocks and allows family access', () => {
  const core = makeCore();
  const sunita = client(core).login('9876500002');
  // Sunita has medicines consent from Kamla but not reports
  assert.ok(sunita.get('/api/reminders/today?member=usr_kamla').doses.length);
  assert.throws(() => sunita.get('/api/records/timeline?member=usr_kamla'), /403/);
  const kamla = client(core).login('9876500003');
  kamla.put('/api/consents/usr_sunita', { categories: ['medicines', 'location', 'reports'] });
  assert.ok(sunita.get('/api/records/timeline?member=usr_kamla').items.length > 0);
  const log = kamla.get('/api/access-log').items;
  assert.ok(log.some((l) => l.actor_id === 'usr_sunita'));
  kamla.put('/api/consents/usr_sunita', { categories: [] });
  assert.throws(() => sunita.get('/api/reminders/today?member=usr_kamla'), /403/);
  // Guardian sees a dependent child without explicit grant
  const raj = client(core).login('9876500001');
  assert.ok(raj.get('/api/records/timeline?member=usr_arjun').items.length > 5);
});

test('dose actions and refill alert', () => {
  const core = makeCore();
  const kamla = client(core).login('9876500003');
  const doses = kamla.get('/api/reminders/today').doses;
  const missed = doses.find((d) => d.status === 'missed');
  assert.ok(missed);
  const r = kamla.post(`/api/reminders/doses/${missed.id}`, { action: 'taken', camera_verified: true });
  assert.equal(r.dose.status, 'taken');
  const sch = kamla.get('/api/schedules').items;
  assert.ok(sch.find((s) => s.drug === 'Atorvastatin 10mg').adherence_7d < 100);
  assert.ok(kamla.get('/api/reminders').items.some((x) => x.kind === 'refill'));
});

test('book doctor → confirm → consult → Rx → reminders + record → order → OTP delivery → escrow released', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const docs = raj.get('/api/providers?type=doctor&specialty=General%20Physician').items;
  assert.ok(docs.length >= 1);
  assert.ok(docs.every((d) => d.verified));
  const stale = docs.find((d) => d.id === 'prv_doc_stale');
  assert.equal(stale && stale.freshness, 'unconfirmed');
  const anil = docs.find((d) => d.id === 'prv_doc_anil');
  const slots = raj.get(`/api/providers/${anil.id}/slots`).items.filter((s) => s.status === 'open');
  const tomorrowSlots = slots.length ? slots : raj.get(`/api/providers/${anil.id}/slots?date=${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}`).items.filter((s) => s.status === 'open');
  const slot = tomorrowSlots[0];
  const quote = raj.post('/api/bookings/quote', { slot_id: slot.id, offer_code: 'CARE10' });
  assert.equal(quote.total, 400);
  assert.equal(quote.discount, 40);
  let b = raj.post('/api/bookings', { slot_id: slot.id, member_id: 'usr_kamla', offer_code: 'CARE10' });
  assert.equal(b.status, 'requested');
  assert.equal(b.price, 360);
  assert.throws(() => raj.post('/api/bookings', { slot_id: slot.id }), /409/);
  b = raj.post(`/api/provider/bookings/${b.id}/confirm`);
  assert.equal(b.status, 'confirmed');
  assert.ok(b.token_no);
  const room = raj.post(`/api/consultations/${b.id}/start`);
  assert.ok(room.template.items.length);
  const rx = raj.post(`/api/provider/consultations/${b.id}/prescription`, { diagnosis: 'URTI', notes: 'rest', items: [{ drug: 'Cetirizine 10mg', dose: '1 tablet', frequency: '0-0-1', food: 'after food', days: 5 }, { drug: 'Paracetamol 650mg', dose: '1 tablet', frequency: '1-0-1', food: 'after food', days: 3 }], follow_up_days: 5 });
  assert.ok(rx.signed);
  const kamla = client(core).login('9876500003');
  assert.ok(kamla.get('/api/schedules').items.some((s) => s.drug === 'Cetirizine 10mg'), 'schedule auto-created');
  assert.ok(kamla.get('/api/records/timeline?type=prescription').items.some((r) => r.ref_id === rx.id), 'Rx on timeline');

  const opts = raj.get(`/api/prescriptions/${rx.id}/pharmacies`).options;
  assert.ok(opts[0].all_available);
  let o = raj.post('/api/orders', { prescription_id: rx.id, pharmacy_id: opts[0].pharmacy.id });
  assert.equal(o.status, 'placed');
  o = raj.post(`/api/provider/orders/${o.id}/verify`, {});
  o = raj.post(`/api/provider/orders/${o.id}/dispatch`);
  const tracked = raj.get(`/api/orders/${o.id}`);
  assert.equal(tracked.status, 'dispatched');
  assert.match(tracked.otp, /^\d{4}$/);
  assert.throws(() => raj.post(`/api/provider/orders/${o.id}/handover`, { otp: '0000' }), /Wrong OTP/);
  const done = raj.post(`/api/provider/orders/${o.id}/handover`, { otp: tracked.otp });
  assert.equal(done.status, 'delivered');
  const fin = raj.post(`/api/orders/${o.id}/confirm-receipt`);
  assert.equal(fin.status, 'completed');
  const w = raj.get('/api/wallet');
  assert.ok(w.transactions.some((t) => t.ref_id === o.id && t.escrow_state === 'released'));
  assert.ok(kamla.get('/api/records/timeline?type=medicine').items.length >= 1);
});

test('substitution needs patient consent; OTC store blocks Rx drugs', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const opts = raj.get('/api/prescriptions/rx_kamla_1/pharmacies').options;
  const full = opts.find((x) => x.all_available);
  let o = raj.post('/api/orders', { prescription_id: 'rx_kamla_1', pharmacy_id: full.pharmacy.id });
  o = raj.post(`/api/provider/orders/${o.id}/verify`, { substitute: { from: 'Atorvastatin 10mg', to: 'Atorvastatin 10mg (generic)', unit_price: 3.9 } });
  assert.equal(o.status, 'substitution_pending');
  const before = o.total;
  o = raj.post(`/api/orders/${o.id}/substitution`, { approve: true });
  assert.equal(o.status, 'verified');
  assert.ok(o.total < before);
  assert.throws(() => raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'Amlodipine 5mg', qty: 10 }] }), /needs a prescription/);
  const otc = raj.post('/api/orders', { pharmacy_id: 'prv_ph_sanjeevani', items: [{ drug: 'ORS sachet', qty: 5 }] });
  assert.equal(otc.status, 'placed');
});

test('lab booking at home, cancellation refund, report with trend', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const labs = raj.get('/api/providers?type=lab&home=1').items;
  assert.ok(labs.length);
  const lab = labs[0];
  let slots = raj.get(`/api/providers/${lab.id}/slots`).items.filter((s) => s.status === 'open');
  if (!slots.length) slots = raj.get(`/api/providers/${lab.id}/slots?date=${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}`).items.filter((s) => s.status === 'open');
  const b1 = raj.post('/api/bookings', { slot_id: slots[0].id, service: 'HbA1c', mode: 'home', member_id: 'usr_kamla' });
  assert.equal(b1.price, 450 * (lab.id === 'prv_lab_pathcare' ? 1 : 0.92) + 99 || b1.price);
  const c1 = raj.post(`/api/bookings/${b1.id}/cancel`, { reason: 'test' });
  assert.equal(c1.status, 'cancelled_by_patient');
  assert.equal(c1.refund_pct, 100);
  const b2 = raj.post('/api/bookings', { slot_id: slots[1].id, service: 'HbA1c', mode: 'home', member_id: 'usr_kamla' });
  raj.post(`/api/provider/bookings/${b2.id}/confirm`);
  raj.post(`/api/provider/bookings/${b2.id}/report`, { values: [{ test: 'HbA1c', value: 6.7, unit: '%', ref_range: '< 5.7' }] });
  const trend = raj.get('/api/records/trends?member=usr_kamla').items.find((t) => t.test === 'HbA1c');
  assert.equal(trend.points.at(-1).value, 6.7);
  assert.ok(trend.points.length >= 5);
});

test('unconfirmed booking auto-cancels with refund after 10 min', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const p = raj.get('/api/providers?type=doctor&specialty=Dermatologist').items[0];
  let slots = raj.get(`/api/providers/${p.id}/slots?date=${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}`).items.filter((s) => s.status === 'open');
  const b = raj.post('/api/bookings', { slot_id: slots[0].id });
  advance(11);
  core.tick();
  const after = raj.get(`/api/bookings/${b.id}`);
  assert.equal(after.status, 'cancelled_by_provider');
  assert.ok(raj.get('/api/wallet').transactions.some((t) => t.direction === 'credit' && t.ref_id === b.txn_id));
});

test('SOS: contacts, ER with emergency consent, ambulance, close revokes', () => {
  const core = makeCore();
  const kamla = client(core).login('9876500003');
  const s = kamla.post('/api/sos', { lat: 19.12, lng: 72.846 });
  assert.equal(s.status, 'active');
  const keys = s.steps.map((x) => x.step);
  for (const k of ['triggered', 'location_shared', 'contacts_notified', 'hospital_notified', 'ambulance_assigned', 'emergency_card_shared']) assert.ok(keys.includes(k), k);
  assert.ok(s.emergency_card.allergies.includes('Penicillin'));
  const raj = client(core).login('9876500001');
  assert.ok(raj.get('/api/notifications').items.some((n) => n.kind === 'sos'));
  assert.equal(raj.get('/api/sos/active').items.length, 1);
  const hospitalCan = core.c.consent.can(s.hospital.id, 'usr_kamla', 'reports');
  assert.ok(hospitalCan);
  kamla.post(`/api/sos/${s.id}/doctor`);
  const closed = kamla.post(`/api/sos/${s.id}/close`, { reason: 'resolved' });
  assert.equal(closed.status, 'closed');
  assert.ok(!core.c.consent.can(s.hospital.id, 'usr_kamla', 'reports'), 'emergency access revoked');
});

test('remedies hide contraindicated items and route red flags', () => {
  const core = makeCore();
  const kamla = client(core).login('9876500003');
  const r = kamla.get('/api/remedies');
  assert.ok(r.hidden.some((h) => h.title === 'Methi dana water'));
  assert.ok(!r.items.some((i) => i.title === 'Methi dana water'));
  assert.equal(kamla.post('/api/remedies/check', { text: 'I have chest pain and sweating' }).route, 'sos');
  assert.equal(kamla.post('/api/remedies/check', { text: 'fever for 3 days now' }).route, 'doctor');
  assert.equal(kamla.post('/api/remedies/check', { text: 'bloating after dinner' }).route, 'remedies');
});

test('family: add dependent, add adult invite, roles, emergency card edit, share link', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const dep = raj.post('/api/family/members', { name: 'Meera Kumar', relation: 'Daughter', dob: '2023-01-05', sex: 'F', dependent: true });
  assert.equal(dep.role, 'dependent');
  const adult = raj.post('/api/family/members', { name: 'Anita Rao', relation: 'Sister', phone: '9876500099' });
  assert.equal(adult.role, 'member');
  const fam = raj.get('/api/family');
  assert.equal(fam.members.length, 7);
  assert.deepEqual(fam.members.find((m) => m.id === adult.id).access, []);
  raj.put(`/api/family/members/${adult.id}/role`, { role: 'caregiver' });
  const card = raj.put('/api/emergency-card', { member_id: 'usr_arjun', allergies: ['Peanuts', 'Dust mites'] });
  assert.equal(card.allergies.length, 2);
  const rec = raj.get('/api/records/timeline?member=usr_arjun').items[0];
  const share = client(core).login('9876500001').post(`/api/records/${rec.id}/share`, { minutes: 60 });
  const pub = client(core).get(share.path);
  assert.equal(pub.record.id, rec.id);
  advance(61);
  assert.throws(() => client(core).get(share.path), /410/);
});

test('wallet: offers, subscription, statement; admin verification', () => {
  const core = makeCore();
  const raj = client(core).login('9876500001');
  const w = raj.get('/api/wallet');
  assert.ok(w.summary.spent > 0);
  assert.equal(raj.post('/api/wallet/offers/validate', { code: 'firstlab', category: 'lab', amount: 600 }).discount, 120);
  raj.post('/api/wallet/subscriptions', { plan: 'chronic_care' });
  assert.equal(raj.get('/api/wallet').subscriptions.length, 2);
  assert.match(raj.get('/api/wallet/statement').csv, /^date,member/);
  const q = raj.get('/api/admin/providers').items;
  assert.ok(q.length >= 3);
  assert.equal(raj.post('/api/admin/providers/prv_doc_vikram/verify', { decision: 'approve' }).status, 'verified');
  assert.equal(raj.post('/api/admin/providers/prv_doc_sanjay/verify', { decision: 'approve' }).status, 'rejected');
  const m = raj.get('/api/admin/metrics');
  assert.ok(m.verified_providers > 10);
});

test('new user sign-up and family creation', () => {
  const core = makeCore();
  const u = client(core).login('9123456789', 'Priya Nair');
  assert.equal(u.get('/api/me').user.name, 'Priya Nair');
  u.post('/api/family', { name: 'Nair Family' });
  assert.equal(u.get('/api/family').members[0].role, 'leader');
  const d = u.get('/api/dashboard');
  assert.deepEqual(d.doses, []);
});
