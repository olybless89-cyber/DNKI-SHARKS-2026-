# System architecture

## Overview

```
 Participants / staff (browser, phone)
            │ HTTPS
            ▼
   CDN + WAF (to be provisioned)
            │
            ▼
 ┌──────────────────────┐    /api/v1/* rewrite (same origin)    ┌──────────────────────────┐
 │ apps/web (Next.js)   │ ─────────────────────────────────────▶ │ apps/api (Fastify)       │
 │ landing, portal,     │                                        │ modules: auth, membership│
 │ admin, /scanner      │                                        │ registration, payments,  │
 └──────────────────────┘                                        │ accreditation, scanning, │
                                                                 │ events, admin, outbox    │
                                                                 └──────────┬───────────────┘
                                                                            │ pg pool
                    Payment provider ◀── server-to-server verify ──┐        ▼
                    (Paystack / Flutterwave / sandbox)             │  ┌─────────────┐
                    ── signed webhooks ──▶ /payments/webhooks/:p ──┘  │ PostgreSQL  │
                    Membership source (registry / DNKI API)           └─────────────┘
                    SMTP provider ◀── outbox worker                   Redis (optional, rate limits)
```

- The browser only talks to the web origin. Next.js rewrites `/api/v1/*` to the API, so the
  session cookie is first-party and **CORS is never enabled** on the API.
- The API is stateless; any number of instances can run behind a load balancer. Shared state is
  PostgreSQL (and Redis for rate limits when more than one instance runs).
- Workers (outbox delivery, payment reconciliation) run inside API instances when
  `WORKER_ENABLED=true`. They use `FOR UPDATE SKIP LOCKED`, so several instances can run them safely.
  For large deployments, run one dedicated worker instance and set `WORKER_ENABLED=false` elsewhere.

## Modules (`apps/api/src/modules`)

| Module          | Responsibility                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | signup, login, lockout, sessions, email verification, password reset/change, TOTP MFA, recovery codes                                                                 |
| `membership`    | `MembershipVerificationProvider` interface and adapters; contact-code verification; officer review; CSV import; record correction                                     |
| `events`        | event config, categories/fees/capacity, programme, public content (announcements, Facebook links)                                                                     |
| `registration`  | registration creation, capacity, state machine (`service.ts` is the only writer of `registrations.status`)                                                            |
| `payments`      | `PaymentProvider` interface; mock/Paystack/Flutterwave; checkout; webhooks; `applyVerifiedPayment` (only path that marks payment successful); reconciliation; refunds |
| `accreditation` | credential issuance, QR, pass, reissue, revoke, suspend/reinstate                                                                                                     |
| `scanning`      | gates, devices, staff assignment, atomic scan, overrides, history, attendance, incidents                                                                              |
| `notifications` | durable outbox, email adapters (log/SMTP), templates                                                                                                                  |
| `admin`         | overview metrics, users & roles, audit viewer, restricted export, dev mailbox (demo only)                                                                             |

## Critical flows

### Payment → credential

1. `POST /registrations/:id/checkout` creates a `payment_orders` row with a server-generated
   reference and the fee snapshot, then calls the provider's hosted checkout.
2. Provider webhook → signature check → `payment_webhook_events` (unique on provider + dedupe key) →
   **independent `verifyTransaction()` call** → `applyVerifiedPayment()`.
3. `applyVerifiedPayment()` locks the order row (`FOR UPDATE`), validates reference, amount,
   currency and status, checks the registration is still payable and no other order succeeded, then in
   one transaction: records the transaction, marks the order succeeded, moves the registration to
   `paid`, issues the credential (if membership still eligible) and moves it to `accredited`, and
   enqueues receipt + invitation in the outbox.
4. The browser return page calls `GET /payments/orders/:ref/status`, which also re-verifies with the
   provider. Redirect parameters are never trusted.
5. A reconciliation worker re-verifies `initiated/pending` orders every 5 minutes and expires
   abandoned ones.

Idempotency layers: webhook dedupe key; order row lock; `payment_orders_one_success_idx`;
`accreditation_one_active_idx`; outbox `idempotency_key`.

### Atomic admission

`POST /scanner/scan` runs in one transaction. The admission itself is a single conditional update:

```sql
update accreditation_credentials c set admitted_at = now(), …
  from registrations r
 where c.id = $1 and r.id = c.registration_id and r.status = 'accredited'
   and c.status = 'active' and c.admitted_at is null
returning c.id
```

PostgreSQL row locking guarantees only one concurrent statement matches; others re-evaluate after
the winner commits and match zero rows (→ `ALREADY_CHECKED_IN`). Device heartbeat writes happen
outside this transaction to avoid lock-order deadlocks (found and fixed during concurrency testing).

## Configuration and environments

All configuration is environment variables validated at boot (`apps/api/src/config.ts`). The API
**refuses to start** in staging/production with demo mode, insecure cookies, disabled rate limits or
placeholder keys, and in production with the mock payment provider or log email adapter.
See `.env.example`.
