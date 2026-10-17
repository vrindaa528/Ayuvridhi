# Aayuvridhi — One Patient. One Connected Healthcare Journey.

A working full-stack MVP of the Aayuvridhi platform: a Node.js backend (REST API + SQLite) integrated with a mobile-first web app, covering all eight modules plus the Trust and Smart Serviceability layers.

## Run it

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite`). No `npm install` needed — the server has zero dependencies.

```bash
npm start            # http://localhost:3000
npm test             # 84 tests: flows, SMS OTP login, security/roles, red flags, server boot
```

The first start creates `data/aayuvridhi.db` and seeds a demo family. Delete the `data/` folder (or use Profile → Reset demo data) to start fresh.

**Demo logins** (OTP is always `123456` in demo mode):

| Phone | Who |
| --- | --- |
| 98765 00001 | Rajesh Kumar — Family Leader (parents, wife, son) |
| 98765 00003 | Kamla Devi — 68, diabetic, on 3 medicines |
| 98765 00002 | Sunita Kumar — caregiver |
| 98765 00004 | Ramesh Kumar — hypertension |

Any other 10-digit number creates a new account.

**Demo staff logins** (demo mode only, OTP `123456`). Each one can act only for the provider record it is linked to. The Partner console switches between them with the role buttons.

| Phone | Role | Acts for |
| --- | --- | --- |
| 98765 00051 | doctor | Dr. Priya Sharma (cardiology) |
| 98765 00052 | doctor | Dr. Anil Mehta (general physician) |
| 98765 00061 | pharmacy | Sanjeevani Pharmacy |
| 98765 00062 | pharmacy | HealthFirst Chemist |
| 98765 00063 | pharmacy | Apna Medical Store |
| 98765 00071 | lab | Pathcare Diagnostics |
| 98765 00072 | lab | Precision Labs |
| 98765 00081 | rider | delivers for Sanjeevani Pharmacy |
| 98765 00091 | clinic_staff | Metro Hospital desk |
| 98765 00099 | ops | Trust & operations (admin routes) |

Outside demo mode these numbers are ordinary accounts with no staff access. Ops links real staff to provider records with `POST /api/admin/provider-accounts` (role must fit the provider type).

### Real OTP on your phone

By default no SMS is sent: demo numbers use `123456` and any other number's OTP is printed in the server console. To text real OTPs:

1. Create a free Twilio account at twilio.com.
2. In the Twilio Console, open **Verify → Services → Create new** (name it Aayuvridhi) and copy the **Service SID** (starts with `VA`).
3. Copy your **Account SID** and **Auth Token** from the Console home page.
4. Trial accounts only text numbers you have verified: add your mobile under **Phone Numbers → Verified Caller IDs**.
5. Copy `.env.example` to `.env` and set `SMS_PROVIDER=twilio` plus the three Twilio values.
6. `npm start`, open http://localhost:3000 and log in with your number. The OTP arrives by SMS.

To open the app on your phone, keep the phone on the same Wi-Fi and visit `http://<your-laptop-IP>:3000`.

For production in India, use `SMS_PROVIDER=msg91` with a DLT-registered OTP template. The demo family numbers (98765 000xx) never trigger a real SMS. OTP requests have a 30-second resend cooldown and lock after 5 wrong attempts.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DEMO_MODE` | `1` | `0` = random OTPs, no autopilot, no demo reset, no demo staff sign-in |
| `DB_PATH` | `data/aayuvridhi.db` | SQLite file |
| `JWT_SECRET` | demo secret | **Required when `DEMO_MODE=0`** (at least 32 random characters). The server refuses to start without it. Also seeds the keyed hash used for OTPs and delivery codes. |
| `TRUST_PROXY` | `0` | `1` = take the client IP from `X-Forwarded-For` (only behind a proxy you control). Rate limits use the IP. |
| `TZ` | `Asia/Kolkata` | Timezone for dose schedules |
| `SMS_PROVIDER` | empty | `twilio` or `msg91` to send real OTP SMS (see above) |

In demo mode, clinics confirm bookings and pharmacies verify/dispatch orders automatically after ~8 seconds, and deliveries arrive in ~2 minutes, so one person can walk every flow. Profile → **Partner console** lets you play the clinic, doctor, lab, pharmacy and delivery partner yourself.

## Try these journeys

1. **Missed-dose escalation** — log in as Rajesh: Kamla's missed Atorvastatin is on Home, already pushed + SMS'd to him.
2. **Consult → Rx → delivery** — Care → Dr. Anil Mehta → book for Kamla → join consult → sign the e-prescription → order from it → watch tracking → enter the delivery OTP → confirm receipt (escrow released).
3. **Lifelong records** — Records → Kamla: HbA1c trend; Arjun: birth record and vaccinations since 2018.
4. **SOS** — log in as Kamla, hold SOS 3 s; then log in as Rajesh to see the live alert.
5. **Dadi Ke Nuskhe** — Kamla sees methi water hidden because she takes Metformin; typing "chest pain" routes to SOS, not a remedy.
6. **Trust layer** — Profile → Trust & operations → approve Dr. Vikram Malhotra (passes) and Dr. Sanjay K. (fails the registration check).

## How it's built

```
core/                 Business logic — runs unchanged on the server and in the browser prototype
  app.js              createCore(): wires DB, event bus, consent, notify and all modules
  schema.js           SQL schema (SQLite; same tables port to PostgreSQL)
  consent.js          The single consent + audit choke point for cross-person data
  events.js           Transactional outbox (rx.issued, dose.missed, order.delivered, sos.started…)
  notify.js           In-app feed + push/SMS adapter hook
  seed.js             Demo data: Kumar family, 20 providers, stock, records, payments
  modules/
    identity.js       OTP login, profile, home dashboard, notifications        (all modules)
    reminders.js      Dose schedules, dose actions, missed-dose escalation      Module 1
    consult.js        Video consult session, signed e-prescription              Module 2
    pharmacy.js       Order from Rx, store, substitution, delivery, OTP handover Module 2
    booking.js        Slot hold, two-step confirmation, refunds, lab reports    Module 3
    serviceability.js Live slots, distance/ETA, wait, price, freshness          Module 3 + platform
    family.js         Family Leader view, roles, per-category consent           Module 4
    wallet.js         Payments ledger, escrow, refunds, plans, offers           Module 5
    records.js        Timeline, uploads, trends, Emergency Card, share links    Module 6
    sos.js            SOS fan-out, ER + ambulance, time-boxed emergency access  Module 7
    wellness.js       Routines, preventive guidance, Dadi Ke Nuskhe, red flags  Module 8
    admin.js          Provider verification queue, platform metrics             Trust layer
server/
  index.js            node:http server, JWT (HS256), static files, 5-second scheduler
  sms.js              Real OTP SMS adapters: Twilio Verify and MSG91
  db-node.js          node:sqlite adapter (swap for PostgreSQL with the same 4 methods)
public/               Web app (vanilla JS, no build step)
  index.html, styles.css
  js/lib.js           API client, router, helpers, icons
  js/screens-*.js     Screens per module
scripts/
  build-prototype.js  Bundles core + app + SQLite (sql.js) into one HTML file
tests/flows.test.js   End-to-end tests for every module
tests/sms.test.js     OTP login through the real server against stand-in Twilio/MSG91 APIs
```

**Key design decisions**

- **Consent is enforced in one place.** Every read of someone else's clinical data goes through `consent.resolve()`, which checks the grant and writes the access log the patient can see.
- **Events, not tangled calls.** Issuing a prescription emits `rx.issued`; records, reminders and notifications each react. Adding a module means subscribing, not editing others.
- **Money is a ledger with escrow.** Bookings and orders are captured into escrow and released on confirmation or delivery; refunds always go back to source. No stored balance (that needs an RBI PPI licence).
- **Adapters at the edges.** Payments, SMS, video, maps, ABDM and ambulance partners are simulated behind adapter seams so production providers slot in without touching module logic.

## Rebuild the standalone prototype

```bash
npm install --no-save sql.js@1.13.0
npm run build:prototype      # → dist/aayuvridhi-prototype.html
```

The prototype runs the same `core/` code in the browser on SQLite compiled to JavaScript and saves each viewer's demo data in IndexedDB.

## Security (Phase 1)

- **Roles on every request.** Users have a role (`patient`, `doctor`, `pharmacy`, `lab`, `rider`, `clinic_staff`, `ops`). The role is read from the database on each call, not trusted from the token, so a revoked staff link stops working immediately.
- **Ownership.** `provider_accounts` links a staff login to provider records. A doctor can only confirm their own bookings and write prescriptions for them. A pharmacy can only verify and dispatch its own orders. Riders can hand over orders of the pharmacy they are linked to.
- **Admin is ops-only.** Every `/api/admin/*` route requires `ops`. A test calls every staff route with a patient and anonymous token and checks for 403 and 401.
- **No plaintext codes.** Login OTPs are stored as keyed hashes (HMAC with a key derived from `JWT_SECRET`). Delivery handover codes are never stored: they are derived on demand, shown only to the patient while the delivery is live (12 hours), and checked against a keyed hash.
- **Rate limits.** OTP requests (per IP and per number), OTP verification, SOS creation, uploads and share links. Limits return `429` with a retry time.
- **Validation.** Profile and record bodies are checked for types, lengths and formats.
- **Red flags.** Symptom routing matches whole words and ignores negated symptoms ("no chest pain"). It still escalates when a real symptom appears alongside a negated one.
- **Audit log.** Staff actions, handover attempts and refused (403) requests are written to `access_logs` with the actor and IP.
- **Headers.** The static app is sent with a Content-Security-Policy, `X-Frame-Options: DENY` and a strict Referrer-Policy.
- **Share links** use 24 random bytes from the platform CSPRNG.

## Feature status

Honest status as of Phase 1. **Real** means working code with no outside service; **Stand-in only** means the real integration exists as a seam but has only been tested against a local fake; **Demo** means simulated behaviour.

| Area | Status |
| --- | --- |
| Login by OTP (SMS via Twilio Verify or MSG91) | Real (SMS tested against stand-in servers; not tested with real keys) |
| Roles, staff links, ownership on provider and admin routes | Real |
| Delivery handover code, keyed hashes, rate limits, audit log | Real |
| Medicine reminders, family mode, consent, records, timeline | Real logic; reminders go to in-app feed only |
| Red-flag symptom routing | Real rules, pattern-based; **not clinically validated** |
| Payments, escrow, refunds | Demo (ledger only, no gateway) |
| SMS/push/WhatsApp for reminders and SOS | Demo (logged, not sent) |
| Video consults | Demo (no video provider) |
| Maps, ETA, rider GPS | Demo (straight-line simulation) |
| Record file storage and OCR | Demo (file name only) |
| ABHA/ABDM, registry checks | Demo (format check only, labelled as such in the code) |
| Provider apps (doctor, pharmacy, lab, rider, ops) | Demo console only; separate apps not built |

Phases 2 to 6 of the platform plan (new modules, real adapters, consoles, Postgres, CI) are not started. See `docs/IMPLEMENTATION_PLAN.md`.

## Path to production

See the Technical Architecture doc. In short: React Native app on the same API; NestJS + PostgreSQL (the schema ports directly) + Redis/BullMQ for the scheduler; Razorpay Route for escrow; MSG91 + FCM for notifications; 100ms/Agora for video; ABDM sandbox → certification for ABHA and record exchange; AWS ap-south-1 for data residency.

**Not production-ready as is.** Phase 1 closed the access-control and secrets gaps: the server now refuses to start without `JWT_SECRET`, and staff routes are role- and owner-checked. Still open: payments, notifications, video, maps and storage are simulated (see the status table), there is no separate staff app or login UI outside the demo console, the rate limiter is in memory (one instance only), and nothing has been penetration-tested. Remedy and red-flag content needs review by a BAMS/MD doctor, and compliance notes need review by a lawyer, before real patients use it.
