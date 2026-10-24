# Test plan

## Automated (run on every push via `.github/workflows/ci.yml`)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @dnki/web build && pnpm audit --audit-level high
```

API tests run against a real PostgreSQL database recreated from migrations
(`apps/api/test/global-setup.ts`; refuses any database whose name lacks "test").

| Suite                                 | Coverage                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/test`                | state machine, RBAC separation of duties, schemas, money                                                                                              |
| `apps/api/test/end-to-end.test.ts`    | Spec scenario 1–10, 12, 13, 15; return URL not trusted; forged webhook; duplicate registration; terms required                                        |
| `apps/api/test/concurrency.test.ts`   | atomic check-in (30 concurrent scans), at-most-once fulfilment (15 concurrent), out-of-order, mismatch, post-cancel payment, capacity race            |
| `apps/api/test/security.test.ts`      | auth, sessions, CSRF, MFA, RBAC, enumeration, manual review, import, audit immutability                                                               |
| `apps/api/test/accreditation.test.ts` | revoke, reissue, hash-only storage, refund, suspend/reinstate, standing, gate/device binding, identity check, override limits, re-entry, outbox retry |
| `apps/api/test/providers.test.ts`     | Paystack/Flutterwave signature + mapping, config safety, rate limiting                                                                                |

Latest result: see `IMPLEMENTATION_STATUS.md` (69 tests passing on 24 Oct 2026).

## Spec scenario coverage

| #    | Step                                                                                                                           | Status                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 1–10 | Account → membership → register → sandbox pay → backend verify → credential → pass → admit → second scanner duplicate detected | Automated                                      |
| 11   | Access protected stream                                                                                                        | Phase 5                                        |
| 12   | Ineligible member denied                                                                                                       | Automated                                      |
| 13   | Unpaid member denied accreditation                                                                                             | Automated                                      |
| 14   | Revoked member denied playback                                                                                                 | Phase 5 (gate denial for revoked is automated) |
| 15   | Duplicate webhook → no extra credential                                                                                        | Automated                                      |

## Still to do

- **Provider sandboxes:** checklist in `PAYMENT_INTEGRATION.md`.
- **Load (Phase 7):** `load-tests/` with k6 at 2× agreed peak; targets — registration API p95 < 500 ms, scan p95 < 300 ms, zero double fulfilment/admission. Record throughput, p95/p99, errors, DB CPU/connections, bottlenecks here.
- **Physical devices:** camera scanning on the Android/iOS models DNKI will use, in venue lighting.
- **Security:** external penetration test; dependency review; header/TLS scan of staging.
- **Restore drill:** per `DISASTER_RECOVERY.md`.
- **Accessibility:** keyboard and screen-reader pass of portal and scanner.

## Results log

| Date       | Test                                                            | Environment              | Result                    |
| ---------- | --------------------------------------------------------------- | ------------------------ | ------------------------- |
| 2026-10-24 | Automated suites                                                | Local, PostgreSQL 16     | 69/69 passed              |
| 2026-10-24 | Browser walkthrough (participant, admin, scanner manual lookup) | Local, headless Chromium | Passed, no console errors |
