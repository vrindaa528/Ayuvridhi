# Aayuvridhi — One Patient. One Connected Healthcare Journey.

A working full-stack MVP of the Aayuvridhi platform: a Node.js backend (REST API + SQLite) integrated with a mobile-first web app, covering all eight modules plus the Trust and Smart Serviceability layers.

## Run it

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite`). No `npm install` needed — the server has zero dependencies.

```bash
npm start            # http://localhost:3000
npm test             # 15 end-to-end tests (flows + SMS OTP login)
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
| `DEMO_MODE` | `1` | `0` = random OTPs, no autopilot for clinics/pharmacies, no demo reset |
| `DB_PATH` | `data/aayuvridhi.db` | SQLite file |
| `JWT_SECRET` | demo secret | **Set this in any shared deployment** |
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

## Path to production

See the Technical Architecture doc. In short: React Native app on the same API; NestJS + PostgreSQL (the schema ports directly) + Redis/BullMQ for the scheduler; Razorpay Route for escrow; MSG91 + FCM for notifications; 100ms/Agora for video; ABDM sandbox → certification for ABHA and record exchange; AWS ap-south-1 for data residency.

**Not production-ready as is:** demo OTP and JWT secret defaults (real SMS OTP is available — see above), provider/ops routes are open to any logged-in user (they need role checks), payments/SMS/video are simulated, and uploaded files keep only their name (no object storage yet).
