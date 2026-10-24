# Go-live checklist

Production readiness requires every item to be ticked with evidence. **Current state: not ready.**

## Decisions and content (DNKI)

- [ ] Authoritative membership source approved and loaded/connected
- [ ] Payment provider selected; live merchant account verified
- [ ] Event dates, venue, categories, fees, capacity, programme entered by an Event Administrator
- [ ] Privacy notice and terms approved (NDPA review) and published
- [x] Official DNKI crest and SHARKS 2026 emblem applied (taken from dnkiconvergeportal.com; confirm DNKI approves this use)
- [x] Accreditation contacts published (from dnkiconvergeportal.com)
- [ ] Re-entry policy and identity-check categories decided

## Functional

- [x] Only verified members can register (automated)
- [x] Registration requires verified payment (automated, sandbox)
- [ ] Payment verification and reconciliation pass the provider sandbox checklist
- [x] Duplicate webhooks do not create duplicate fulfilment (automated)
- [x] Unique credential per accredited participant; revocation works (automated)
- [x] Concurrent duplicate admissions prevented (automated)
- [x] Gate permissions and audit logging (automated)
- [ ] Protected streaming enforced server-side (Phase 5)
- [x] Public content separated and labelled PUBLIC
- [x] MFA enforced for privileged accounts (automated)

## Operational

- [ ] Staging deployed with production-equivalent configuration
- [ ] Load test at 2× forecast peak meets targets
- [ ] External security test; critical/high findings resolved
- [ ] Backup restore rehearsed within RTO
- [ ] Monitoring and alerting live; on-call rota for event window
- [ ] Incident response rehearsed (gate outage, compromised account)
- [ ] Scanner devices registered, tested on site, staff trained
- [ ] Email domain authenticated (SPF/DKIM/DMARC); deliverability tested
- [ ] `DEMO_MODE=false`, no synthetic records in production database
- [ ] Authorised DNKI stakeholders sign off go-live
