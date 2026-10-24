# Accreditation operations and event-day manual

## Credentials

- Issued automatically when a payment is verified **and** the member is still verified and in good standing.
- Accreditation ID format `DNKI-XXXXX-XXXXX` (an identifier, not a secret).
- QR = `DNKI1.` + 256-bit random token. Contains no name, phone, email or payment data. Only a SHA-256
  hash is used for validation; staff screens never show tokens.
- **Reissue** (lost phone, suspected leak): old QR stops working instantly; admission state carries over.
- **Revoke**: entry refused; registration becomes `revoked`; participant emailed.
- **Suspend / reinstate** via the registration record.

## Before the event

1. Event admin: set gate policy (single entry or re-entry), pass validity window, identity-check categories.
2. Create gates (`Admin → Gates & scanners`) and assign accreditation officers to gates.
3. Gate supervisors open `/scanner` on each phone/tablet, choose the gate and **register the device**.
4. All staff sign in and complete MFA on their own device before event day.
5. Test each device: scan a synthetic pass in staging; confirm camera permission and network.
6. Print the supervisor fallback list (below) and confirm the venue network (wired/LTE backup).

## Scanning

| Screen                             | Meaning                                          | Action                                      |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| Green ✓ VALID — ADMIT              | First valid admission recorded                   | Admit. Compare name/chapter if in doubt     |
| Red ↻ ALREADY CHECKED IN           | Pass was already used (time and gate shown)      | Do not admit. Call supervisor               |
| Red ✕ INVALID CREDENTIAL           | Not a pass from this system                      | Do not admit                                |
| Red ! PAYMENT OR ELIGIBILITY ISSUE | Unpaid, suspended or member not in good standing | Send to accreditation desk                  |
| Red ✕ REVOKED CREDENTIAL           | Revoked or replaced by a reissue                 | Do not admit. Inform supervisor             |
| Red ✕ EXPIRED CREDENTIAL           | Outside validity window                          | Send to desk                                |
| Amber ! MANUAL REVIEW REQUIRED     | Category needs photo ID                          | Check ID, then "Identity confirmed — admit" |
| Amber ! TEMPORARY SYSTEM FAILURE   | Server could not decide                          | **Do not admit.** Retry; follow fallback    |

Supervisors can **override** duplicate and identity-review results with a written reason (audited).
Overrides can never admit revoked, unpaid or ineligible passes.

## Offline / outage fallback (no offline mode by design)

Disconnected scanners cannot prevent the same pass being used at two gates, so the scanner fails
closed and shows "Offline — do not admit".
1. Supervisor declares the outage, logs an incident, and moves queues to gates that are online.
2. If all gates are offline: hold entry, or admit only via the supervisor desk using a printed
   attendee list (accreditation ID + name, exported before doors open by an authorised exporter),
   ticking names by hand and checking photo ID.
3. After recovery: officers record manual admissions with overrides (reason "outage admission"),
   so attendance and duplicate detection are restored.

## Reports

`Admin → Attendance`: totals, currently inside, per-gate admissions and suspicious scans, full scan
log. `Admin → Registrations → Export CSV` (restricted, audited, no contact or payment data).
