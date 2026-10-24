# Implementation status

_Last updated: 24 October 2026._ This file is the source of truth for what is built,
what is tested, and what is still open. Nothing below is claimed unless it was run.

## Update — 24 October 2026 (afternoon): DNKI Converge 2026 details applied

Source: the live DNKI site dnkiconvergeportal.com (home and register pages).

- **Branding:** official DNKI crest and SHARKS 2026 emblem (`apps/web/public/brand/`), DNKI red
  `#C8102E`, black `#0A0A0A`, the glowing red headline and the scrolling edition/theme/date strip.
- **Event facts** (migration `0003_converge_2026_details.sql`, all admin-editable): the 18th DNKI Converge,
  SHARKS 2026 International Converge, *Rebuilding the Brotherhood, Empowering Our Future*,
  10–13 December 2026, and the two accreditation contacts.
- **Registration form now matches DNKI's:** Norish name, Norsical name, patrol (66 options),
  designation (6), Friday and Saturday meals (4 each), passport photo, hard-drugs declaration and the
  conduct-rule agreement. Choice lists are managed under *Event settings → Registration choices*.
- **Passport photos** are shown on the pass, at the gate scanner (identity check) and to registration staff.
  Files are checked by signature, capped at 2 MB, resized in the browser, never exported.
- **Catering:** the admin overview counts Friday/Saturday meal choices of confirmed delegates; the CSV
  export includes patrol, designation and meals (not the drug declaration, email or phone).
- Tests: 78 passing (12 shared, 66 API, including 9 new delegate tests). Browser walkthrough re-run with the new form.

**Decisions needed from DNKI arising from their current site**

1. **Bank transfer + uploaded receipt.** Their current form takes a screenshot of a bank transfer as proof of
   payment. This platform deliberately does not accept screenshots as proof; payments are confirmed with the
   provider. If DNKI must keep bank transfers, the safe option is a "bank transfer" method where a finance
   officer matches each transfer against the bank statement before accreditation (not built yet).
2. **Hard-drugs declaration "Yes".** Stored and flagged to staff; registration is not blocked. DNKI to decide the policy.
3. **Venue, fees and categories** are not published on their site; the demo categories remain placeholders.
4. **Membership numbers.** Their form does not collect one; this platform still requires membership verification.

## Summary

| Phase                       | Status                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Foundation                | **Done** — monorepo, schema/migrations, auth, sessions, MFA, RBAC, audit, design system, landing page, shells                                                                                                                                                    |
| 2 Membership & registration | **Done** — provider interface + registry/API/manual adapters, contact-code verification, officer review, CSV import, registration lifecycle                                                                                                                      |
| 3 Payments                  | **Done with sandbox** — provider interface, mock sandbox, Paystack & Flutterwave adapters (unit-tested, **not exercised against provider sandboxes**), webhooks, idempotent fulfilment, reconciliation, refunds                                                  |
| 4 Accreditation             | **Done** — opaque QR credentials, pass/badge, reissue/revoke, scanner app, atomic check-in, re-entry policy, overrides, attendance, incidents                                                                                                                    |
| 5 Streaming                 | **Not started** (schema and UI placeholders only; Facebook/public announcements management is done)                                                                                                                                                              |
| 6 Administration            | **Partly done** — overview, event config, membership, registrations, payments, credentials, gates, attendance, incidents, public content, users/roles, audit log, one restricted CSV export. Missing: notification management UI, broader reports, dual approval |
| 7 Production assurance      | **Not started** — no load tests run, no external security test, no backup-restore drill, no monitoring stack                                                                                                                                                     |

## Verified test results (24 Oct 2026, local PostgreSQL 16)

`pnpm test`:
- `packages/shared` — 12 tests passed (state machine, separation of duties, schemas, money).
- `apps/api` — 57 tests passed across 5 files:
  - `end-to-end.test.ts` — spec scenario steps 1–10, 12, 13, 15 via HTTP with the sandbox provider.
  - `concurrency.test.ts` — **30 concurrent scans across 2 gates → exactly 1 admission**; **15 concurrent verifications of one payment → exactly 1 fulfilment, 1 credential, 1 invitation**; late `failed` after success ignored; amount mismatch held for review; payment after cancellation held for review; capacity 3 under 8 concurrent registrations → 3 accepted.
  - `security.test.ts` — argon2id storage, signup non-enumeration, lockout, idle expiry, logout invalidation, reset revokes sessions & single-use tokens, CSRF, no internals in errors, MFA gating, participant blocked from admin, separation of duties, no self-role-grant, role change forces re-login, membership anti-enumeration, code goes only to contact on record, one record ↔ one account, manual review incl. no self-approval, CSV import validation, append-only audit.
  - `accreditation.test.ts` — revocation at gate, reissue invalidates old QR and carries admission, token hash-only storage, refund revokes, suspend/reinstate, loss of standing refused, invalid/malformed QR, gate assignment and device binding, manual lookup permission, identity-check flow, override never admits revoked, re-entry entry/exit counting, outbox retry + sensitive body scrubbing.
  - `providers.test.ts` — Paystack HMAC-SHA512 webhook check and verify mapping; Flutterwave verif-hash and float-free amount conversion; unsafe production config refused; rate limiting returns 429.
- `pnpm lint` (Biome) clean; `pnpm typecheck` clean; `next build` succeeds (29 routes).
- Manual browser walkthrough (headless Chromium, desktop + 390 px mobile): signup → email code → membership code → register → sandbox checkout → server verification → pass; admin CLI bootstrap → MFA enrolment → overview; scanner manual lookup → VALID ADMIT → ALREADY CHECKED IN → INVALID CREDENTIAL. No console errors.

Not covered by tests yet: streaming steps 11 and 14 (Phase 5), real provider sandboxes, load, camera-based scanning on physical devices, email delivery through a real SMTP provider.

## Decisions taken (and why)

| Decision                                                                                                    | Reason                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fastify modular monolith instead of NestJS                                                                  | Smaller surface, explicit SQL, faster tests; modules are separated by domain (`apps/api/src/modules/*`).                                                           |
| Raw SQL (`pg`) with hand-written migrations                                                                 | Admission and fulfilment correctness depends on precise locking/conditional `UPDATE`s; an ORM would obscure them.                                                  |
| Postgres-backed durable outbox and workers instead of Redis queues                                          | Notifications commit atomically with the business change; one less critical dependency. Redis is used only as the shared rate-limit store when `REDIS_URL` is set. |
| Scanner inside the web app (`/scanner`) rather than a separate app                                          | One deployment, same auth/session model, mobile-first route.                                                                                                       |
| Online-only scanning; **no offline mode**                                                                   | Offline cannot guarantee global single-use admission. Fail closed; supervisor fallback in `ACCREDITATION_OPERATIONS.md`.                                           |
| Credential tokens stored as SHA-256 hash for lookup + AES-256-GCM copy so the owner can re-display the pass | Staff/admin records never expose a usable token; participant can always retrieve their pass.                                                                       |
| Session cookies (`__Host-` prefixed, HttpOnly, SameSite=Lax) + mandatory `x-dnki-csrf` header on writes     | Lax is required for the payment provider's return redirect; the header blocks cross-site writes.                                                                   |

## Open decisions requiring DNKI approval

1. **Authoritative membership source** — registry import vs DNKI API vs manual only (see `MEMBERSHIP_INTEGRATION.md`). Required: data owner, fields, contact-on-record quality.
2. **Payment provider** — Paystack vs Flutterwave (comparison in `PAYMENT_INTEGRATION.md`). Required: merchant account, test keys, settlement currency, refund policy.
3. **Video provider** — Cloudflare Stream vs Mux (Phase 5).
4. **Hosting, domain, email provider** (SMTP/transactional), optional WhatsApp provider.
5. **Event facts** — venue, fees, categories, capacity and programme (dates, contacts and logo now applied from DNKI's site).
6. **Legal texts** — privacy notice and terms (NDPA review), refund policy.
7. **Peak concurrency forecast and venue connectivity** — needed to size infrastructure and run Phase 7 load tests.
8. **Re-entry policy and identity-check categories** — configurable; DNKI must choose.

## Known gaps and risks (not yet resolved)

- Paystack/Flutterwave adapters have only been unit-tested with mocked HTTP. Refund webhooks are handled minimally.
- Streaming (Phase 5) is absent; the admin overview reports it as "not configured".
- No monitoring/alerting, backup automation or WAF configured (deployment not performed).
- Dual approval for highly sensitive actions (role grants, bulk imports) is not implemented; actions require a reason and are audited.
- WhatsApp delivery adapter not implemented (email only).
- Accessibility reviewed by hand (keyboard focus, labels, non-colour scan results); no formal WCAG audit.
- Commits in this repository are authored by the build session's git identity; rewrite authorship before handover if required.

## Next milestones

1. DNKI decisions above → configure provider sandboxes → run the checklists in `PAYMENT_INTEGRATION.md`.
2. Phase 5 streaming (provider comparison, entitlements, signed playback, revocation tests).
3. Phase 6 remainder (notification management, reports, dual approval).
4. Phase 7 (staging deploy, load tests at 2× forecast, restore drill, monitoring, external security review).
