# Disaster recovery

Status: **procedures written, not yet rehearsed.** A restore drill is a go-live requirement.

## Targets (proposed, for DNKI approval)

- RPO ≤ 5 minutes (managed PostgreSQL point-in-time recovery).
- RTO ≤ 30 minutes during the event window.

## What must be backed up

- PostgreSQL (all state, including audit log and encrypted pass tokens).
- Secrets (secret manager, versioned) — especially `ENCRYPTION_KEY`; losing it makes passes and
  MFA secrets unrecoverable (passes can be reissued, MFA re-enrolled).
- Not required: application servers (rebuilt from images), Redis (rate-limit counters only).

## Backup protection

Provider-encrypted, private storage only, access restricted to the technical lead role, access
logging enabled, retention ≥ 30 days, no exports to personal devices.

## Restore procedure

```bash
# 1. Restore to a NEW instance from PITR (provider console/CLI) at the chosen timestamp.
# 2. Verify integrity
psql "$RESTORED_URL" -c "select count(*) from registrations; select max(occurred_at) from administrative_audit_events;"
# 3. Point DATABASE_URL at the restored instance, redeploy API.
# 4. Run payment reconciliation (Admin → Payments → Run reconciliation) to catch payments made after the restore point.
# 5. Compare provider settlement report with payment_orders for the gap window.
```

## Drill checklist

Restore staging from a backup, time each step, run the API test suite against a copy, record
results in `TEST_PLAN.md`.
