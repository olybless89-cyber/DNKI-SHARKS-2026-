# Database schema

Source of truth: `apps/api/migrations/*.sql` (applied in order by `pnpm db:migrate`, which also
syncs `roles`, `permissions` and `role_permissions` from `packages/shared/src/rbac.ts`).

Conventions: UUID primary keys (identity bigints for append-only logs); `timestamptz` everywhere;
money as `bigint` minor units (returned to Node as strings); explicit `check` constraints for status
columns.

## Tables

| Area          | Table                                                    | Notes                                                                                                         |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Identity      | `users`                                                  | `email citext unique`, argon2id `password_hash`, lockout counters, encrypted TOTP secret, `mfa_last_timestep` |
|               | `sessions`                                               | `token_hash` (SHA-256) unique; expiry, revocation, MFA-verified timestamp                                     |
|               | `one_time_codes`                                         | HMAC'd 6-digit codes (email, membership contact) and hashed reset tokens; attempts, expiry                    |
|               | `mfa_recovery_codes`                                     | hashed, single-use                                                                                            |
| RBAC          | `roles`, `permissions`, `role_permissions`, `user_roles` | synced from code; grants record granter and reason                                                            |
| Audit         | `administrative_audit_events`                            | append-only (triggers block UPDATE/DELETE/TRUNCATE)                                                           |
| Event         | `events`                                                 | single active event (`events_single_active_idx`); dates, policy, legal texts, FAQs                            |
|               | `event_sessions`                                         | programme items                                                                                               |
|               | `registration_categories`                                | `fee_minor > 0`, currency, capacity, identity-check flag                                                      |
|               | `announcements`                                          | `visibility = 'public'` enforced by constraint; https-only URLs                                               |
| Membership    | `member_records`                                         | `membership_number unique`, standing, source, `linked_user_id unique`                                         |
|               | `membership_verifications`                               | at most one open and one approved per user (partial unique indexes)                                           |
|               | `import_jobs`                                            | validated rows staged, errors reported, applied once                                                          |
| Registration  | `registrations`                                          | one active per member and per user per event (partial unique indexes); fee snapshot                           |
|               | `registration_status_history`                            | every transition with actor and reason                                                                        |
| Payments      | `payment_orders`                                         | unique reference; one open and one successful order per registration                                          |
|               | `payment_transactions`                                   | unique (provider, provider_transaction_id)                                                                    |
|               | `payment_webhook_events`                                 | unique (provider, dedupe_key); signature result; processing status                                            |
|               | `refunds`                                                | one active refund per order                                                                                   |
|               | `sandbox_mock_payments`                                  | mock provider backing store (sandbox only)                                                                    |
| Accreditation | `accreditation_credentials`                              | unique `accreditation_id`, unique `token_hash`, encrypted token; one active per registration; admission state |
|               | `credential_events`                                      | issued / revoked / reissued / superseded / suspended / reinstated / admitted / override                       |
| Venue         | `gates`, `scanner_devices`, `scanner_gate_assignments`   | device bound to one gate                                                                                      |
|               | `attendance_events`                                      | every scan incl. refusals; `counted` marks first admissions                                                   |
|               | `security_incidents`                                     | category, severity, status, resolution                                                                        |
| Notifications | `notifications`                                          | durable outbox, unique `idempotency_key`, retries with backoff                                                |
|               | `dev_mailbox`                                            | demo-mode inbox only                                                                                          |

Migration `0003` adds: `events.edition`, `events.contacts`; `registration_options` (patrol,
designation, meal_friday, meal_saturday choice lists, unique per event/kind/label);
delegate columns on `registrations` (Norish/Norsical names, option references, hard-drugs
declaration, conduct-rule acceptance time); `participant_photos` (one per user, ≤ 2 MB,
JPEG/PNG/WebP, SHA-256 recorded).

Phase 5 will add `streaming_sessions`, `streaming_entitlements`, `playback_authorization_events`.

## Key indexes for hot paths

- Credential validation: `accreditation_credentials.token_hash` (unique), `.accreditation_id` (unique).
- Payment reconciliation: `payment_orders (status, created_at)`.
- Membership lookup: `member_records.membership_number` (unique), `email`, `lower(full_name)` prefix.
- Attendance: `attendance_events (gate_id, created_at desc)`, `(credential_id)`.
- Review queue: `membership_verifications (status, created_at)`.
