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

1. Only verified, eligible members may register.
2. Paid registration only.
3. Backend-confirmed payment before a valid credential.
4. Unique ID and unpredictable QR per participant.
5. Server-side validation of every QR.
6. Many gates and devices concurrently.
7. Atomic single-use admission with duplicate detection.
8. Members-only streaming portal.
9. Public Facebook content kept separate.
10. Scale to more than 10,000 registrations.
11. RBAC, MFA for privileged users, audit, monitoring, backups.
12. DNKI black, red and white identity.
13. Responsive.
14. No invented secrets or data.
15. No unverified claims.

## Event facts (from dnkiconvergeportal.com, October 2026)

- The 18th DNKI Converge — **SHARKS 2026 International Converge**.
- Theme: **Rebuilding the Brotherhood, Empowering Our Future**.
- Thursday 10 – Sunday 13 December 2026. Venue and fees not yet published.
- Contacts: Director, Accreditation — Hon. Azulo Solomon (+234 703 670 5032); Skull Pilot Team — Hon. Bern Atavi (0813 630 1662).
- Delegate fields: Norish name, Norsical name, patrol (66 options), designation (FF, PAC, Bot Member, NEC,
  Sailyn Council, Deckhand), Friday and Saturday arrival meals, passport photo, email, phone,
  hard-drugs declaration, agreement to the conduct rule.
- Brand: DNKI crest (RC 7458, "Service to Humanity"), SHARKS 2026 emblem, black `#0A0A0A`,
  DNKI red `#C8102E`, white, glowing red headline (`#FF1A1A`).

## Out of scope for Phases 1–4

Protected streaming, WhatsApp delivery, offline scanning, dual approval, native mobile apps.

## Unresolved inputs

See "Open decisions" in `IMPLEMENTATION_STATUS.md`.

## Data protection

Personal data processed: name, email, optional phone, membership number, chapter/zone, standing,
Norish/Norsical names, patrol, designation, meal choices, passport photograph, the hard-drugs
declaration, registration and payment status (no card data), attendance events. The passport
photo and the hard-drugs declaration are sensitive: they are visible only to the participant and
to staff with registration, credential or scanning permissions, are excluded from the CSV export,
and DNKI must decide how long to keep them. DNKI is the data controller.
Obligations under the **Nigeria Data Protection Act 2023** to be reviewed by DNKI's authorised
representative: lawful basis and notice, data minimisation (implemented in exports and QR), security
measures, retention schedule (to be defined — suggested deletion/anonymisation of attendance and
verification data within 12 months after the event), data-subject rights handling, breach
notification, cross-border transfer assessment for hosting/email/payment providers, and whether
DNKI must register with the NDPC as a data controller of major importance. **No compliance or
certification is claimed.**
