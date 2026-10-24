# Deployment runbook

Nothing has been deployed. This runbook describes the intended staging/production setup.
Do not deploy to production, take real payments or incur costs without DNKI authorisation.

## Components

| Component | Recommended                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API       | `apps/api/Dockerfile`, ≥2 instances behind a load balancer, `TRUST_PROXY=true`                                                                                           |
| Web       | `apps/web/Dockerfile`, ≥2 instances, `API_INTERNAL_URL` = private API address                                                                                            |
| Database  | Managed PostgreSQL 16, HA, PITR backups, encryption at rest, private network only; connection pooling (PgBouncer) if instance count × `DATABASE_POOL_MAX` exceeds limits |
| Redis     | Managed Redis for shared rate limits (`REDIS_URL`) when >1 API instance                                                                                                  |
| Edge      | CDN + WAF in front of the web origin, TLS 1.2+, HSTS; API reachable only via web rewrite and for provider webhooks                                                       |
| Email     | Transactional SMTP provider with SPF/DKIM/DMARC on the sending domain                                                                                                    |
| Secrets   | Hosting provider secret manager; never in images or repository                                                                                                           |

## Steps (staging first)

```bash
# 1. Build images from repository root
docker build -f apps/api/Dockerfile -t dnki-api:$(git rev-parse --short HEAD) .
docker build -f apps/web/Dockerfile -t dnki-web:$(git rev-parse --short HEAD) .

# 2. Configure environment (see .env.example). Staging/production MUST set:
#    APP_ENV, DEMO_MODE=false, COOKIE_SECURE=true, ENCRYPTION_KEY (openssl rand -base64 32),
#    DATABASE_URL, PUBLIC_WEB_URL, PAYMENT_PROVIDER + keys, EMAIL_PROVIDER=smtp + SMTP_*, REDIS_URL

# 3. Run migrations once per release (before new code takes traffic)
docker run --rm --env-file staging.env dnki-api:<tag> node dist/scripts/migrate.js

# 4. Bootstrap the first super administrator (once)
docker run --rm -it --env-file staging.env dnki-api:<tag> node dist/scripts/create-admin.js --email ops@<domain> --name "Name"

# 5. Deploy API and web; verify
curl -fsS https://<domain>/api/v1/public/event
curl -fsS http://<api-private>/ready
```

The API refuses to boot with unsafe settings; read the startup error if it exits.

## Release and rollback

- Migrations are forward-only and additive; write the next release so it tolerates the previous schema.
- Rollback = redeploy previous image tag. If a migration must be reverted, restore from PITR into a
  new instance and repoint (see DISASTER_RECOVERY).

## Monitoring to configure (not yet done)

`/ready` checks, 5xx rate, p95 latency per route, `payment_orders` in `needs_review`, failed
webhooks, outbox `failed` count, DB CPU/connections, scan rate per gate. Alert on-call during the
event window.
