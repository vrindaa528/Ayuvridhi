'use strict';
// identity: phone OTP login, profile, notification feed, home dashboard.

const { must, ageFrom, safeEqual, validate } = require('../util');

const STAFF_ROLES = ['doctor', 'pharmacy', 'lab', 'rider', 'clinic_staff', 'ops'];

function publicUser(c, u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    dob: u.dob,
    age: u.dob ? ageFrom(u.dob, c.now()) : null,
    sex: u.sex,
    blood_group: u.blood_group,
    abha_id: u.abha_id,
    city: u.city,
    language: u.language,
    lat: u.lat,
    lng: u.lng,
    role: u.role || 'patient',
  };
}

const DEMO_PHONE = /^98765000\d\d$/;
const isDemoPhone = (p) => DEMO_PHONE.test(p);

// 6-digit code from a CSPRNG where available (Node and browsers both have it).
function crypto6() {
  const g = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (g && g.getRandomValues) {
    const a = new Uint32Array(1);
    g.getRandomValues(a);
    return 100000 + (a[0] % 900000);
  }
  return Math.floor(100000 + Math.random() * 900000);
}

function register(r, c) {
  const { db } = c;
  const otpHash = (phone, code) => c.keyed(`otp|${phone}|${code}`);

  // OTP modes (deps.otpMode):
  //   null       → no SMS provider: code is printed to the server console (demo: fixed code)
  //   'sms'      → we generate the code; the host sends it (MSG91)
  //   'external' → the provider generates and checks the code (Twilio Verify);
  //                the host handles /verify for these numbers before core sees it
  // Demo family numbers (98765 000xx) always use the fixed demo code and never
  // trigger a real SMS, so nobody's real phone gets texted by the demo.
  // The plaintext code only leaves core through out.secret (for the host to
  // send); it is never written to the database.
  r.post('/api/auth/otp/request', { auth: false, rate: [
    { by: 'ip', name: 'otp-request', limit: 20, windowMs: 10 * 60000 },
    { by: 'phone', name: 'otp-request', limit: 5, windowMs: 10 * 60000, message: 'Too many OTP requests for this number. Try again in 10 minutes.' },
  ] }, ({ body }) => {
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
    must(/^[6-9]\d{9}$/.test(phone), 400, 'Enter a valid 10-digit Indian mobile number');
    const now = c.now();
    const existing = db.get('SELECT * FROM otps WHERE phone = ?', [phone]);
    if (existing && existing.expires_at > now.toISOString()) {
      must(existing.attempts < 5, 429, 'Too many wrong attempts. Try again in 15 minutes.');
      const sentAgoSec = (now - (new Date(existing.expires_at) - 15 * 60000)) / 1000;
      must(sentAgoSec >= 30, 429, `Please wait ${Math.ceil(30 - sentAgoSec)} seconds before requesting another OTP`);
    }
    const demoNumber = isDemoPhone(phone);
    const mode = c.deps.otpMode || null;
    const fixed = c.deps.demoOtp && (!mode || demoNumber);
    const external = mode === 'external';
    const code = fixed ? c.deps.demoOtp : external ? 'EXTERNAL' : String(crypto6());
    db.run('INSERT OR REPLACE INTO otps (phone, code_hash, mode, expires_at, attempts) VALUES (?, ?, ?, ?, 0)', [
      phone,
      external ? null : otpHash(phone, code),
      external ? 'external' : 'code',
      c.util.addMinutes(now, 15).toISOString(),
    ]);
    if (!mode || fixed) c.log('sms', `OTP for ${phone}: ${code} (not sent — no SMS provider${demoNumber ? ' for demo numbers' : ''})`);
    const user = db.get('SELECT id FROM users WHERE phone = ?', [phone]);
    const out = {
      sent: true,
      channel: mode && !fixed ? 'sms' : 'demo',
      is_new_user: !user,
      demo_code: fixed ? c.deps.demoOtp : undefined,
      resend_after_sec: 30,
    };
    // Only the host sees this, to send it by SMS. Not part of the response body.
    const secret = mode && !fixed && !external ? { phone, code } : null;
    return { __secret: secret, __body: out };
  });

  r.post('/api/auth/otp/verify', { auth: false, rate: [
    { by: 'ip', name: 'otp-verify', limit: 30, windowMs: 10 * 60000 },
    { by: 'phone', name: 'otp-verify', limit: 10, windowMs: 15 * 60000, message: 'Too many attempts for this number. Try again in 15 minutes.' },
  ] }, ({ body }) => {
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
    const row = db.get('SELECT * FROM otps WHERE phone = ?', [phone]);
    must(row, 400, 'Request an OTP first');
    must(row.expires_at > c.now().toISOString(), 400, 'OTP expired. Request a new one.');
    must(row.attempts < 5, 429, 'Too many wrong attempts. Try again in 15 minutes.');
    must(row.mode !== 'external', 503, 'OTP service unavailable. Try again.');
    if (!safeEqual(otpHash(phone, String(body.code || '')), row.code_hash)) {
      db.run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', [phone]);
      must(false, 400, 'Incorrect OTP');
    }
    checkName(phone, body.name);
    db.run('DELETE FROM otps WHERE phone = ?', [phone]);
    return issueSession(phone, body.name);
  });

  // New accounts need a name; checked before the OTP is used up.
  function checkName(phone, name) {
    if (db.get('SELECT id FROM users WHERE phone = ?', [phone])) return;
    must(name && String(name).trim().length > 1, 400, 'Tell us your name to create the account');
    must(String(name).length <= 80, 400, 'Name is too long');
  }

  function issueSession(phone, name) {
    let user = db.get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!user) {
      checkName(phone, name);
      const id = c.util.id('usr');
      db.run('INSERT INTO users (id, phone, name, language, city, lat, lng, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        phone,
        String(name).trim(),
        'en',
        'Mumbai',
        19.076,
        72.8777,
        'patient',
        c.now().toISOString(),
      ]);
      db.run('INSERT INTO emergency_cards (patient_id, allergies, conditions, medicines, contacts, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        '[]',
        '[]',
        '[]',
        '[]',
        c.now().toISOString(),
      ]);
      c.events.emit('user.created', { user_id: id });
      user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    }
    const token = c.deps.sign({ sub: user.id, iat: Date.now() });
    return { token, user: publicUser(c, user) };
  }
  c._identity = { issueSession, checkName };

  // DEMO ONLY: a one-click sign-in for each seeded staff role, so the demo's
  // Partner console can play a doctor, pharmacy, lab, rider, clinic or ops
  // user. Refused whenever DEMO_MODE is off.
  r.post('/api/demo/partner-token', { auth: false }, ({ body }) => {
    must(c.deps.demoMode, 403, 'Demo sign-in is only available in demo mode');
    must(STAFF_ROLES.includes(body.role), 400, 'Unknown role');
    const user = db.get("SELECT * FROM users WHERE role = ? AND phone LIKE '98765000%' ORDER BY phone LIMIT 1", [body.role]);
    must(user, 404, 'No demo account for that role');
    return { token: c.deps.sign({ sub: user.id, iat: Date.now() }), user: publicUser(c, user) };
  });

  r.get('/api/me', ({ user }) => {
    const fam = c.consent.familyOf(user.id);
    const role = fam ? db.get('SELECT role FROM family_members WHERE family_id = ? AND user_id = ?', [fam.id, user.id]) : null;
    const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [user.id]).n;
    return { user: publicUser(c, user), family: fam ? { id: fam.id, name: fam.name, role: role && role.role } : null, unread, providers: c.access.providerIds(user) };
  });

  r.put('/api/me', ({ user, body }) => {
    validate(body, {
      name: { max: 80 },
      dob: { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'dob must be YYYY-MM-DD' },
      sex: { max: 1, enum: ['M', 'F', 'O'] },
      blood_group: { max: 4 },
      language: { max: 5 },
      city: { max: 60 },
      abha_id: { max: 40 },
    });
    const fields = ['name', 'dob', 'sex', 'blood_group', 'language', 'city', 'abha_id'];
    for (const f of fields) {
      if (body[f] !== undefined) db.run(`UPDATE users SET ${f} = ? WHERE id = ?`, [body[f], user.id]);
    }
    return { user: publicUser(c, db.get('SELECT * FROM users WHERE id = ?', [user.id])) };
  });

  r.get('/api/notifications', ({ user }) => {
    const items = db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40', [user.id]);
    return { items: items.map((n) => Object.assign(n, { channels: c.util.json(n.channels, []) })) };
  });

  r.post('/api/notifications/read', ({ user }) => {
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [user.id]);
  });

  // Home screen in one call: today's doses, alerts across the family,
  // upcoming bookings, active orders and wellness for the selected member.
  r.get('/api/dashboard', ({ user, query }) => {
    const patientId = c.consent.resolve(user, query.member, 'medicines', 'dashboard');
    const target = db.get('SELECT * FROM users WHERE id = ?', [patientId]);
    const doses = c.api.dosesForDay(patientId, c.now());
    const upcoming = db.all(
      `SELECT b.*, p.name AS provider_name, p.type AS provider_type, p.specialty, s.start_at
       FROM bookings b JOIN providers p ON p.id = b.provider_id LEFT JOIN slots s ON s.id = b.slot_id
       WHERE b.patient_id = ? AND b.status IN ('requested','confirmed','checked_in','in_consult')
       ORDER BY s.start_at LIMIT 5`,
      [patientId]
    );
    const orders = db.all(
      `SELECT o.id, o.status, o.total, o.created_at, p.name AS pharmacy_name, d.eta_at
       FROM orders o JOIN providers p ON p.id = o.pharmacy_id LEFT JOIN deliveries d ON d.order_id = o.id
       WHERE o.patient_id = ? AND o.status NOT IN ('delivered','cancelled') ORDER BY o.created_at DESC`,
      [patientId]
    );
    const due = db.all('SELECT * FROM reminders WHERE patient_id = ? AND done = 0 ORDER BY due_on LIMIT 5', [patientId]);
    const alerts = c.api.familyAlerts(user.id);
    const activeSos = db.get("SELECT id FROM sos_events WHERE patient_id = ? AND status = 'active'", [patientId]);
    return {
      member: publicUser(c, target),
      doses,
      upcoming,
      orders,
      reminders: due,
      alerts,
      routines: patientId === user.id ? c.api.routinesToday(user.id) : [],
      active_sos: activeSos ? activeSos.id : null,
    };
  });
}

function api(c) {
  return {
    issueSession: (phone, name) => c._identity.issueSession(phone, name),
    checkName: (phone, name) => c._identity.checkName(phone, name),
  };
}

module.exports = { register, api, publicUser, isDemoPhone, STAFF_ROLES };
