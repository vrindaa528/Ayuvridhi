# Implementation plan

Status key: `done` · `partial` · `todo` · `blocked` (needs credentials, a legal or clinical decision, or a human).
Updated after each commit on `feature/complete-platform`.

## Phase 1 — Security, roles and cleanup

| Item | Status | Notes |
| --- | --- | --- |
| 1.1 Roles on users; JWT role checked per request | done | Role read from DB each call (`core/app.js`) |
| 1.1 `provider_accounts` (user ↔ provider, role) | done | Seeded demo staff; ops can link and revoke |
| 1.1 Lock `/api/provider/*` and `/api/admin/*` by role | done | Route `roles` option; test calls every staff route as patient and anonymous |
| 1.1 Ownership: pharmacy / doctor / lab own records only | done | `c.access.assertOwns`; cross-provider tests |
| 1.1 Demo ops user and provider logins, documented | done | README table; demo mode only |
| 1.1 Tests: patient 403, cross-provider denied | done | `tests/security.test.js` |
| 1.2 Remove `orders.otp_plain` | done | Column dropped on upgrade (`ensureColumns`) |
| 1.2 Delivery code derived, patient-only, short-lived | done | Derived per request; 12 h window; never stored |
| 1.2 Hash login OTPs (`otps.code` → keyed hash) | done | `code_hash` + `mode`; plaintext only passed to the SMS host |
| 1.2 Refuse to boot without `JWT_SECRET` when `DEMO_MODE=0` | done | Also refuses demo secret and secrets under 32 chars |
| 1.3 Rate limits per IP and per phone (OTP) | done | Also SOS, uploads, share links |
| 1.3 Rate limits on verify, login, SOS, upload | done | OTP verify (IP and phone), SOS, records and Rx upload, share links |
| 1.3 Validation helper; applied to all POST/PUT | partial | Helper in `core/util.js`; applied to `/api/me`, `/api/records`. Remaining routes listed in FOUND_ISSUES |
| 1.3 Security headers on static responses | done | CSP, X-Frame-Options, Referrer-Policy |
| 1.3 Share-link tokens from CSPRNG | done | `secureToken`, 48 hex chars |
| 1.3 Audit log with actor and IP for provider/ops actions | done | `access_logs.action`, `.ip`; refused requests logged too |
| 1.4 Red-flag word boundaries, negation, 30+ test table | done | 84 cases. Clinical review still `blocked` on a BAMS/MD or EM reviewer |

## Phase 2 — Module completion

| Item | Status | Notes |
| --- | --- | --- |
| 2.1.1 Custom dose times, quiet hours, timezone | todo | |
| 2.1.2 Real push/SMS/WhatsApp, escalation ladder | blocked | Needs FCM, MSG91 DLT templates, WhatsApp setup |
| 2.1.3 PWA, service worker, manifest, Web Push | todo | |
| 2.1.4 Vaccination scheduler (UIP data) | todo | Needs a paediatric reviewer for the schedule data |
| 2.1.5 Data-driven preventive rules | todo | |
| 2.1.6 Habit tracking edit/delete, templates, family | todo | |
| 2.1.7 Scan pack: real verification or remove the flag | todo | Current flag `camera_verified` is still set without verification |
| 2.2.1 Real video consult | blocked | Needs 100ms or Agora keys |
| 2.2.2 Doctor console (role-gated) | todo | Demo console only today |
| 2.2.3 Signed e-prescription, verification endpoint, QR | todo | Needs an Ed25519 key plan and the NMC telemedicine fields |
| 2.2.4 Chat with doctor during and after consult | todo | |
| 2.2.5 Prescription OCR | blocked | Needs Vision or Textract keys |
| 2.2.6 Drug master data module, H1/X rules | todo | Needs a drug database licence decision |
| 2.2.7 Interaction and allergy checks | todo | Needs clinical review of rules |
| 2.2.8 Pharmacy console (role-gated) | todo | |
| 2.2.9 Rider app, GPS, handover photo, refunds | todo | Maps adapter blocked on a key |
| 2.2.10 Partial fill, split orders, refills, refund rules | todo | |
| 2.3.1 Real provider availability schedules | todo | |
| 2.3.2 Real freshness (no 5 s tick) | todo | FOUND_ISSUES #8 |
| 2.3.3 Reschedule | todo | |
| 2.3.4 Reviews and ratings | todo | |
| 2.3.5 Maps and geocoding adapter | blocked | Needs a maps key |
| 2.3.6 Wait time from live queue | todo | |
| 2.3.7 Lab catalogue, prep instructions, price comparison | todo | |
| 2.3.8 Hospital departments, insurance flag | todo | |
| 2.4.1 Remove member, leave family, transfer leader | todo | |
| 2.4.2 Real invites (SMS/WhatsApp) | blocked | Needs SMS provider templates |
| 2.4.3 Multiple family groups: decide and record | todo | Decision needed |
| 2.4.4 Dependent to independent transition | todo | |
| 2.4.5 Family health overview and weekly digest | todo | |
| 2.4.6 Consent UX: time-bound grants, access-log export | todo | |
| 2.5.1 Payments adapter (Razorpay) with webhooks and escrow | blocked | Needs Razorpay keys and a split/escrow setup |
| 2.5.2 Subscriptions with enforced perks and auto-renew | todo | |
| 2.5.3 Offers engine | todo | |
| 2.5.4 Invoices (PDF, GST fields), annual summary | todo | |
| 2.5.5 Refund states, payouts ledger | todo | |
| 2.5.6 Reconciliation job, ops mismatch view | todo | |
| 2.6.1 Real file storage (S3 ap-south-1, encrypted) | blocked | Needs S3 bucket and keys |
| 2.6.2 OCR and classification from content | blocked | Needs OCR keys |
| 2.6.3 Abnormal flags, trends, plain-language summary | todo | |
| 2.6.4 Edit, delete, restore records; merge | todo | |
| 2.6.5 ABDM/ABHA adapter (sandbox) | blocked | Needs ABDM sandbox onboarding |
| 2.6.6 Export ZIP and FHIR R4 mapping | todo | |
| 2.6.7 Milestones, growth charts, vitals | todo | Growth-chart data needs a paediatric reviewer |
| 2.6.8 Follow-up reminders from notes and labs | todo | |
| 2.7.1 Real SOS notifications with acknowledgement | blocked | Needs SMS and IVR keys |
| 2.7.2 Police (112) flow | todo | |
| 2.7.3 Ambulance dispatch adapter | blocked | Needs partner API |
| 2.7.4 Emergency doctor on video | blocked | Needs video keys and an on-duty pool |
| 2.7.5 Emergency Card QR/NFC responder access | todo | |
| 2.7.6 Offline SOS fallback (sms: and tel:) | todo | |
| 2.7.7 Check-in timer and soft SOS | todo | |
| 2.7.8 Post-incident summary and feedback | todo | |
| 2.8.1 At least 120 reviewed remedies (JSON) | blocked | Needs BAMS/MD review; unreviewed content must not be shown |
| 2.8.2 Prakriti quiz and drug–herb table | blocked | Needs clinical review |
| 2.8.3 "Wellness guidance, not treatment" on every card | todo | |
| 2.8.4 Full i18n (en, hi, mr) | todo | Translation review needed |
| 2.8.5 Structured red-flag set, Hinglish, modifiers | partial | Phase 1 added negation and word boundaries; modifiers and Hinglish set still todo |
| 2.8.6 Seasonal opt-in push | blocked | Needs push provider |

## Phase 3 — Trust and serviceability

| Item | Status | Notes |
| --- | --- | --- |
| 3.1 Registry adapter (NMC, HPR, HFR, NABL, drug licence) | blocked | Needs registry access |
| 3.1 Document upload and review queue | todo | |
| 3.1 Expiry tracking and auto-suspend | todo | |
| 3.1 Complaints, suspension, appeal, verified badge | todo | |
| 3.1 Rx verification and pharmacist checklist | todo | Depends on 2.2.3 |
| 3.1 Consent screen, receipts, DPDP erasure, retention | todo | Legal review needed |
| 3.2 Single serviceability service | todo | |
| 3.2 Provider-push API and CSV/webhook import | todo | |
| 3.2 Pincode serviceability matrix | todo | |

## Phase 4 — Integrations behind adapters

All ten adapters are `blocked` on credentials (Razorpay, MSG91/DLT, FCM, 100ms/Agora, maps, S3, OCR, ABDM sandbox, registries, ambulance partner) and on the Postgres decision. Each will be tested against a stand-in server only, and labelled that way.

## Phase 5 — Provider apps

| Item | Status | Notes |
| --- | --- | --- |
| Doctor, pharmacy, lab, clinic, rider, ops consoles | todo | Demo console now runs one role at a time with its own staff login |

## Phase 6 — Engineering and compliance

| Item | Status | Notes |
| --- | --- | --- |
| Postgres adapter, migrations folder, runner | todo | `ensureColumns` is a stopgap (D-009) |
| Job runner with locks | todo | |
| CI (GitHub Actions), lint, secret scan | todo | |
| Playwright journeys, coverage ≥ 80% on `core/` | todo | |
| Observability, health with dependencies | todo | |
| Compliance docs in `docs/compliance/` | blocked | Needs counsel review; must say "not legal advice" |
| Accessibility and i18n pass | todo | |
| Performance (pagination, caching) | todo | |
