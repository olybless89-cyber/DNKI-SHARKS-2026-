# Payment integration

Interface: `PaymentProvider` (`apps/api/src/modules/payments/provider.ts`). Selected with
`PAYMENT_PROVIDER` = `mock | paystack | flutterwave`. **No provider has been selected.**

## Comparison (to confirm with each provider's current terms)

| Criterion                                  | Paystack                                                   | Flutterwave                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hosted checkout                            | Transaction Initialize → `authorization_url`               | v3 Standard `/v3/payments` → `link`                                                           |
| Amount format                              | Subunit (kobo) integers                                    | Major units (decimal) — converted without floats                                              |
| Server verification                        | `GET /transaction/verify/:reference`                       | `GET /v3/transactions/verify_by_reference?tx_ref=` (or by id)                                 |
| Webhook authenticity                       | `x-paystack-signature` = HMAC-SHA512(raw body, secret key) | `verif-hash` header = secret hash set in dashboard (v3); newer signed scheme exists — confirm |
| Refunds API                                | Yes                                                        | Yes                                                                                           |
| International cards / currencies           | Confirm for DNKI's diaspora members                        | Confirm                                                                                       |
| Fees, settlement time, chargeback handling | Obtain quote                                               | Obtain quote                                                                                  |

Recommendation criteria for DNKI: support for members paying from abroad, settlement currency and
timing, fees, dispute handling, and which provider DNKI already has a verified merchant account with.

## What is implemented

- Server-generated references (`PAY-` + 12 Crockford chars) and server-side fee snapshot.
- Hosted checkout; callback to `/portal/payment/return?reference=…` which **re-verifies** server-side.
- Webhook endpoint `/api/v1/payments/webhooks/:provider` with raw-body signature verification,
  dedupe, independent verification, and 503 on processing failure so the provider retries.
- `applyVerifiedPayment` — validates reference, amount, currency, status; idempotent; handles
  out-of-order events, reversals (→ `disputed`, credential suspended), duplicates and payments for
  non-payable registrations (→ `needs_review`).
- Reconciliation worker (5 min) and manual re-verify / reconcile actions for finance.
- Refunds: provider refund → completion revokes accreditation and refunds registration; refunds of
  `needs_review` payments do not affect the registration.
- No card data ever touches the platform (hosted checkout only). Secrets only in server env.

## Sandbox (mock) provider

`/sandbox/checkout/:reference` lets a tester simulate success or failure. It signs a webhook and
sends it through the real webhook endpoint. Clearly labelled; refused at boot in production.

## Go-live checklist for the chosen provider

1. Create test keys; set `PAYMENT_PROVIDER`, secret key (and Flutterwave webhook hash) in the secret manager.
2. Register the webhook URL `https://<api-domain>/api/v1/payments/webhooks/<provider>`; allow-list provider IPs at the WAF if offered.
3. Confirm against **current official docs**: signature scheme, verify endpoint, status values, amount units, refund webhooks.
4. Run in staging: success, failure, abandonment, duplicate webhook delivery, delayed webhook (block then release), webhook lost (reconciliation recovers), amount tampering, refund, reversal/chargeback.
5. Record results in `TEST_PLAN.md`; only then switch to live keys.

## Behaviour when the provider is down

Checkout returns `503 PAYMENT_PROVIDER_UNAVAILABLE`; registrations stay `awaiting_payment`.
Webhook processing failures are retried by the provider and recovered by reconciliation.
No automatic fallback to another provider.
