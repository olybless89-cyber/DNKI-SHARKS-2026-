# Membership integration

Interface: `MembershipVerificationProvider` (`apps/api/src/modules/membership/provider.ts`).
Selected with `MEMBERSHIP_PROVIDER`.

| Adapter              | When to use                                                                                   | How identity is established                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `registry` (default) | DNKI supplies an authorised member list, loaded by officers through the controlled CSV import | 6-digit code to the email **on the record** (must match what the member types)                                    |
| `api`                | DNKI has a membership API                                                                     | Same; lookups are cached into `member_records` so they can be linked. **Contract is a placeholder and untested.** |
| `manual`             | No automated source                                                                           | Every request goes to the officer review queue                                                                    |

All adapters keep the officer review path open for members who cannot receive the code.

## Rules enforced

- A membership number alone is never accepted. Without a matching contact on record the member
  must go through officer review.
- Only `good_standing` records are eligible; standing is re-checked at payment fulfilment **and at the gate**.
- One member record can be linked to one account (`member_records.linked_user_id unique`).
- Officers cannot decide their own requests; every decision needs a reason and is audited.
- Responses are identical whether or not a member exists (anti-enumeration); attempts are rate limited.

## Controlled CSV import

Columns: `membership_number, full_name, chapter, zone, email, phone, standing`
(`standing` ∈ `good_standing | lapsed | suspended | expelled`).
1. **Validate** (`membership.import`): every row checked; duplicates in file rejected; errors reported by row; SHA-256 of the file recorded in the audit log. Nothing changes.
2. **Apply** (reason required): new records inserted; unlinked records updated; for records already linked to an account, name/email are **not** overwritten — the conflict is reported for a controlled correction (`PATCH /admin/membership/records/:id`, audited with changed fields).

## Information DNKI must provide

- Data owner and lawful basis for processing (NDPA).
- Field definitions, especially which contact is authoritative and how current it is.
- Standing values and how lapsed/suspended members should be treated.
- For the API option: base URL, auth method, rate limits, response schema, SLA and an outage plan.

## Behaviour when the source is unavailable

`api` adapter errors → `503 MEMBERSHIP_SOURCE_UNAVAILABLE`; nothing is approved automatically.
Members can still submit a manual review request. Never switch to accepting unverified members.

## Tests required before go-live

Real-format sample import (synthetic values), error report review, API contract tests against a
DNKI staging endpoint, officer workflow rehearsal.
