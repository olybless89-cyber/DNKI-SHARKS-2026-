# Product requirements

Platform for the **SHARKS International Convergence** of De Norsemen Kclub International (DNKI),
theme _Rebuilding the Brotherhood_. Expected registered participants: 10,000+.

## Goals

Every member is verified, every payment is traceable, every credential is accountable, every entry
is auditable, and every protected stream is authorised.

## Users

| Role                            | Needs                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Participant (verified member)   | Verify membership, register, pay, receive and show pass, (Phase 5) watch protected streams |
| Membership Verification Officer | Review requests, import and correct member data                                            |
| Finance Officer                 | Reconcile, re-verify, refund; cannot change membership                                     |
| Accreditation Officer           | Scan at assigned gates, look up, revoke/reissue passes                                     |
| Gate Supervisor                 | Register devices, scan any gate, overrides, incidents                                      |
| Streaming Administrator         | (Phase 5) streams; public content                                                          |
| Event Administrator             | Event configuration, gates, registrations, incidents                                       |
| Auditor / Oversight             | Read-only records and audit log                                                            |
| Super Administrator             | Roles and all configuration (audited)                                                      |

## Non-negotiable rules

1. Only verified, eligible members may register. 2. Paid registration only. 3. Backend-confirmed
   payment before a valid credential. 4. Unique ID + unpredictable QR per participant. 5. Server-side
   validation of every QR. 6. Many gates and devices concurrently. 7. Atomic single-use admission with
   duplicate detection. 8. Members-only streaming portal. 9. Public Facebook content kept separate.
2. Scale to >10,000 registrations. 11. RBAC, MFA for privileged users, audit, monitoring, backups.
3. DNKI black/red/white identity. 13. Responsive. 14. No invented secrets or data. 15. No
   unverified claims.

## Out of scope for Phases 1–4

Protected streaming, WhatsApp delivery, offline scanning, dual approval, native mobile apps.

## Unresolved inputs

See "Open decisions" in `IMPLEMENTATION_STATUS.md`.

## Data protection

Personal data processed: name, email, optional phone, membership number, chapter/zone, standing,
registration and payment status (no card data), attendance events. DNKI is the data controller.
Obligations under the **Nigeria Data Protection Act 2023** to be reviewed by DNKI's authorised
representative: lawful basis and notice, data minimisation (implemented in exports and QR), security
measures, retention schedule (to be defined — suggested deletion/anonymisation of attendance and
verification data within 12 months after the event), data-subject rights handling, breach
notification, cross-border transfer assessment for hosting/email/payment providers, and whether
DNKI must register with the NDPC as a data controller of major importance. **No compliance or
certification is claimed.**
