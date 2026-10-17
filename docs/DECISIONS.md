# Decisions

Each entry: what was decided, why, and what would make us revisit it.

## D-001 Keep zero runtime dependencies (Phase 1)
Core uses `node:sqlite`, `node:crypto` and `fetch`. Nothing new was added in Phase 1. **Revisit** when Postgres, a PDF/OCR library or an SDK (Razorpay, FCM) is needed; each goes behind an adapter and is lazy-loaded (master prompt, ground rule 6).

## D-002 Keyed hashes for OTPs and delivery codes (Phase 1)
Login codes and handover codes are stored as HMAC-SHA256 with a key derived from `JWT_SECRET`, not as plain SHA-256. Without the key, a leaked database cannot be brute-forced for 4- or 6-digit codes. The server derives the key with a fixed label, so changing the label invalidates stored codes.
- Browser prototype: uses a non-cryptographic hash (cyrb53) with a fixed key. It is demo-only, so the keyed hash there is not a security control.
- **Revisit** when real SMS delivery is done through a provider adapter in Phase 4.

## D-003 Delivery code is derived, never stored (Phase 1)
The handover code is `HMAC(key, "handover|orderId|dispatchedAt)` mapped to 1000–9999. The database keeps a keyed check value only. The patient sees the code while the delivery is live (12 hours after dispatch). Pharmacy and rider views never include it. The SMS/push text says "open your order" and does not contain the code, because notification rows are stored.
- **Revisit:** if a phone-delivered code is needed (IVR or SMS with the code), send it through the notify adapter without storing the body.

## D-004 One login method, role on the user, links to provider records (Phase 1)
Staff sign in with the same phone OTP as patients. `users.role` says what the account is. `provider_accounts` says which provider record it acts for. Each request reads the role from the database, so revoking a link takes effect on the next call.
- A phone number can hold one staff role. Linking it again with a different role is refused.
- A rider is linked to the pharmacy it delivers for and may hand over that pharmacy's orders.
- Ops accounts are seeded. They are not created through the API.
- **Revisit:** if one person must be both a doctor and a pharmacy owner. The model supports several links; only the single `users.role` would need to become a list.

## D-005 Demo staff sign-in (Phase 1)
`POST /api/demo/partner-token` returns a token for a seeded staff user. It exists only when `DEMO_MODE` is on and is refused otherwise (tested). The Partner console and `/ops` use it. In production each staff role will sign in through its own app (Phase 5).

## D-006 Audit inside `access_logs` (Phase 1)
Staff actions, handover attempts and every 403 are written as rows in `access_logs` with `action` and `ip` columns. This avoids a second table. Patient-facing access logs show these rows as well, so a patient can see that a provider touched their booking or order. **Revisit** if the two purposes need different retention rules (Phase 3 consent work).

## D-007 Rate limiting is in memory (Phase 1)
A sliding-window limiter in `core/ratelimit.js`, keyed by IP and by phone or user. It is correct for one instance. With several instances, limits are per instance; a shared store (Redis) is needed before horizontal scaling (Phase 6).

## D-008 Client IP (Phase 1)
The IP comes from the socket. `X-Forwarded-For` is trusted only with `TRUST_PROXY=1`. The server overwrites any `x-client-ip` header the client sends.

## D-009 Schema changes without a migration tool (Phase 1)
`ensureColumns` in `core/app.js` adds new columns to existing databases and removes `orders.otp_plain`. This is a stopgap. Phase 6 replaces it with `migrations/NNN_name.sql` and a runner.

## D-010 Red flags are patterns with negation handling (Phase 1)
Rules are word-boundary regular expressions in `core/modules/wellness.js`, with negation before the match ("no", "not", "denies", "nahi") in the same clause, and trailing "nahi/not" directly after it. A negated phrase does not escalate, but any non-negated match still does. A table of 84 cases lives in `tests/wellness.test.js`.
- Known over-escalation, kept on purpose: "pregnancy tips" routes to a doctor.
- These rules are **not clinically validated**. A BAMS/MD or emergency-medicine reviewer must approve the rule set (master prompt §6) before patients rely on it. Phase 2.8.5 expands it.

## D-011 Security headers (Phase 1)
CSP allows `style-src 'unsafe-inline'` because the screens use `style=""` attributes. Scripts are same-origin only. Removing inline styles (Phase 5 UI work) would let us drop `unsafe-inline`.
