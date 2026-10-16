'use strict';
// SQLite schema. Production runs the same tables on PostgreSQL (see the
// architecture doc); JSON columns become JSONB there.
module.exports = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, phone TEXT UNIQUE, name TEXT, dob TEXT, sex TEXT,
  language TEXT DEFAULT 'en', abha_id TEXT, blood_group TEXT, city TEXT,
  lat REAL, lng REAL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS otps (phone TEXT PRIMARY KEY, code TEXT, expires_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, name TEXT, leader_id TEXT);
CREATE TABLE IF NOT EXISTS family_members (
  family_id TEXT, user_id TEXT, role TEXT, relation TEXT, PRIMARY KEY (family_id, user_id)
);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY, grantor_id TEXT, grantee_id TEXT, categories TEXT, purpose TEXT,
  expires_at TEXT, revoked_at TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, patient_id TEXT, category TEXT, purpose TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, type TEXT, name TEXT, specialty TEXT, qualification TEXT, reg_no TEXT,
  lat REAL, lng REAL, address TEXT, fee INTEGER, languages TEXT, rating REAL,
  verified_status TEXT, verified_until TEXT, accreditation TEXT, has_er INTEGER DEFAULT 0,
  avg_wait_min INTEGER DEFAULT 15, queue_len INTEGER DEFAULT 0, home_collection INTEGER DEFAULT 0,
  services TEXT, is_open INTEGER DEFAULT 1, availability_updated_at TEXT
);
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider_id TEXT, check_name TEXT, result TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY, provider_id TEXT, start_at TEXT, end_at TEXT, status TEXT,
  price INTEGER, mode TEXT, hold_expires_at TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, patient_id TEXT, booked_by TEXT, provider_id TEXT, slot_id TEXT, type TEXT,
  mode TEXT, service TEXT, status TEXT, price INTEGER, token_no TEXT, txn_id TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY, booking_id TEXT, doctor_id TEXT, patient_id TEXT, notes TEXT,
  follow_up_on TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY, consultation_id TEXT, patient_id TEXT, doctor_id TEXT, diagnosis TEXT,
  items TEXT, source TEXT, issued_at TEXT
);
CREATE TABLE IF NOT EXISTS stock (
  pharmacy_id TEXT, drug TEXT, qty INTEGER, price REAL, updated_at TEXT, PRIMARY KEY (pharmacy_id, drug)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, patient_id TEXT, placed_by TEXT, pharmacy_id TEXT, prescription_id TEXT,
  items TEXT, status TEXT, subtotal INTEGER, delivery_fee INTEGER, total INTEGER, txn_id TEXT,
  otp_hash TEXT, otp_plain TEXT, substitution TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS deliveries (
  order_id TEXT PRIMARY KEY, partner TEXT, status TEXT, from_lat REAL, from_lng REAL,
  to_lat REAL, to_lng REAL, dispatched_at TEXT, eta_at TEXT, otp_attempts INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, patient_id TEXT, prescription_id TEXT, drug TEXT, dose TEXT,
  instructions TEXT, times TEXT, start_on TEXT, end_on TEXT, grace_min INTEGER DEFAULT 15,
  stock_left INTEGER, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS dose_events (
  id TEXT PRIMARY KEY, schedule_id TEXT, patient_id TEXT, due_at TEXT, status TEXT,
  acted_at TEXT, acted_by TEXT, camera_verified INTEGER DEFAULT 0, reminded INTEGER DEFAULT 0,
  escalated INTEGER DEFAULT 0, snooze_until TEXT, skip_reason TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY, patient_id TEXT, kind TEXT, title TEXT, due_on TEXT, action TEXT, done INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, patient_id TEXT, type TEXT, title TEXT, provider TEXT, date TEXT,
  summary TEXT, file_name TEXT, source TEXT, ref_id TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS lab_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, patient_id TEXT, test TEXT, value REAL,
  unit TEXT, ref_range TEXT, date TEXT
);
CREATE TABLE IF NOT EXISTS emergency_cards (
  patient_id TEXT PRIMARY KEY, blood_group TEXT, allergies TEXT, conditions TEXT, medicines TEXT,
  contacts TEXT, notes TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, payer_id TEXT, member_id TEXT, category TEXT, ref_id TEXT, description TEXT,
  amount INTEGER, direction TEXT, method TEXT, status TEXT, escrow_state TEXT, offer_code TEXT,
  discount INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT, plan TEXT, price INTEGER, period TEXT, status TEXT, renews_on TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  code TEXT PRIMARY KEY, title TEXT, category TEXT, pct INTEGER, max_off INTEGER, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sos_events (
  id TEXT PRIMARY KEY, patient_id TEXT, triggered_by TEXT, status TEXT, lat REAL, lng REAL,
  hospital_id TEXT, ambulance TEXT, ambulance_eta_at TEXT, started_at TEXT, closed_at TEXT, close_reason TEXT
);
CREATE TABLE IF NOT EXISTS sos_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sos_id TEXT, step TEXT, detail TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS sos_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sos_id TEXT, lat REAL, lng REAL, at TEXT
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY, user_id TEXT, title TEXT, target INTEGER, unit TEXT, icon TEXT
);
CREATE TABLE IF NOT EXISTS habit_logs (routine_id TEXT, day TEXT, count INTEGER, PRIMARY KEY (routine_id, day));
CREATE TABLE IF NOT EXISTS remedies (
  id TEXT PRIMARY KEY, title TEXT, hindi TEXT, goal TEXT, seasons TEXT, ingredients TEXT,
  method TEXT, when_to_use TEXT, see_doctor TEXT, avoid_if TEXT, reviewed_by TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, kind TEXT, title TEXT, body TEXT,
  channels TEXT, link TEXT, is_read INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, payload TEXT, created_at TEXT, processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dose_patient ON dose_events (patient_id, due_at);
CREATE INDEX IF NOT EXISTS idx_slots_provider ON slots (provider_id, start_at);
CREATE INDEX IF NOT EXISTS idx_records_patient ON records (patient_id, date);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, created_at);
`;
