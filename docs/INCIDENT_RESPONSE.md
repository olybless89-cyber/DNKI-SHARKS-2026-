# Incident response

Roles: Incident lead (Event Administrator on duty), technical lead (platform engineer), DNKI
communications contact, Data Protection Officer contact (for NDPA notifications).

## Severity

| Sev | Examples                                                                             | Response             |
| --- | ------------------------------------------------------------------------------------ | -------------------- |
| 1   | Data breach, payment fraud, gates all offline during entry, admin account compromise | Immediate; all leads |
| 2   | One gate offline, webhook failures, email outage, suspicious scanning pattern        | 15 min               |
| 3   | Single participant issue, minor UI defect                                            | Next business window |

## Playbooks

**Suspected account compromise (staff):** suspend account (`Admin → Users → Suspend`, revokes sessions) → review audit log by actor → revoke/reissue affected credentials → rotate the person's password and MFA.

**Leaked or shared QR:** reissue the credential (old QR dies) → check attendance log for use of old ID → log incident.

**Payment anomaly / suspected spoofing:** check `Admin → Payments` (needs review, webhook rejections) → re-verify affected orders → never mark paid manually (no such function exists) → refund via provider if needed.

**Gate outage:** follow fallback in `ACCREDITATION_OPERATIONS.md`.

**Secret exposure:** rotate the secret in the provider dashboard and secret manager; redeploy. `ENCRYPTION_KEY` rotation requires re-encrypting TOTP secrets and pass tokens — plan a maintenance window (tooling not yet built).

**Personal data breach:** contain → preserve logs → assess → notify DNKI DPO; the NDPA requires notification to the Nigeria Data Protection Commission within 72 hours of becoming aware of a qualifying breach (confirm current guidance with counsel) and affected members where required.

## Records

Log every incident in `Admin → Incidents` with timeline, decisions and resolution. Post-incident
review within 5 working days.
