# Found issues (not fixed yet)

Items found while reading the code. Small ones were fixed in Phase 1; the rest are listed with a proposed fix.

| # | Where | Issue | Proposed fix | Status |
| --- | --- | --- | --- | --- |
| 1 | `core/modules/booking.js` `GET /api/provider/queue` | Was open to any login; now role- and owner-scoped | — | Fixed in Phase 1 |
| 2 | `core/modules/admin.js` `/suspend` | Did not check the provider exists; now returns 404 and is audited | — | Fixed in Phase 1 |
| 3 | `core/modules/records.js` share link | Token came from `util.id` (`Math.random`) and was guessable | Use `secureToken` | Fixed in Phase 1 |
| 4 | `core/modules/consult.js` `rx.signature` | "Signature" is a truncated hash, not an Ed25519 signature | Phase 2.2.3 (signed Rx payload, verification endpoint) | Open |
| 5 | `core/seed.js` verification checks | Seed labels format checks as "… registry lookup", the same wording the UI must not use for format-only checks | Relabel to "Format check" and store the lookup result separately (Phase 3.1) | Open |
| 6 | `core/modules/admin.js` `verify` (~line 50) | The "<registry> lookup" row is computed from the same regex as the format check, so it reports a pass without any registry call | Phase 3.1 registry adapter; show "format check" until then | Open |
| 7 | `core/modules/family.js` | Adding a member to a second family and removing members are not handled; single-family rule unchanged | Decide in Phase 2.4.3 | Open |
| 8 | `core/modules/serviceability.js` `tick` (line ~194) | Every tick sets `availability_updated_at` for all providers except the stale one, so "live" freshness is fake outside demo too | Phase 2.3.2: run this only in demo mode; update on real changes | Open |
| 9 | `core/modules/wellness.js` `/api/remedies` | Hide-if-unsafe only matches the member's own medicine and condition names against the remedy's `avoid_if` list; there is no drug–herb interaction table | Phase 2.8.2 | Open |
| 10 | `core/modules/admin.js` `REG_RULES` | Clinic and hospital share one ABDM facility-ID pattern, so a clinic is checked against the hospital rule | Phase 3.1 registry adapter | Open |
| 11 | `server/index.js` `verifyExternal` | Twilio Verify path does not write to `access_logs` | Add an audit line on login | Open |
| 12 | `public/js/lib.js` | Demo staff tokens are cached in memory only; the Partner console signs in on every page load | Acceptable for demo | Noted |
