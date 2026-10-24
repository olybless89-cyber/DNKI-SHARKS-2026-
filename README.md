# DNKI SHARKS Digital Accreditation Platform

Registration, payment verification, accreditation and venue access control for the
**SHARKS International Convergence** of De Norsemen Kclub International (DNKI).
Theme: _Rebuilding the Brotherhood_.

> **Status:** Phases 1–4 (foundation, membership & registration, payments, accreditation &
> gate scanning) are implemented and tested against a real PostgreSQL database with
> sandbox adapters. Protected streaming (Phase 5), the remaining administration work
> (Phase 6) and production assurance (Phase 7) are **not done**. This is **not production-ready**.
> See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Repository layout

| Path              | What it is                                                                     |
| ----------------- | ------------------------------------------------------------------------------ |
| `apps/api`        | Fastify + TypeScript API, PostgreSQL migrations, workers, integration tests    |
| `apps/web`        | Next.js (App Router) participant portal, admin console and mobile gate scanner |
| `packages/shared` | Shared RBAC matrix, registration state machine, scan results, Zod schemas      |
| `docs`            | Architecture, security, operations and status documentation                    |
| `load-tests`      | k6 scripts (not yet executed)                                                  |

## Quick start (local development)

Requirements: Node 22.12+, pnpm 10, PostgreSQL 16 (Redis optional).

```bash
cp .env.example .env
# generate secrets
sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|; s|^MOCK_PAYMENT_WEBHOOK_SECRET=.*|MOCK_PAYMENT_WEBHOOK_SECRET=$(openssl rand -hex 24)|" .env

docker compose up -d postgres        # or use a local PostgreSQL
pnpm install
pnpm db:migrate
pnpm db:seed -- --demo-staff          # synthetic members DEMO-0001…, demo categories, gates, demo staff
pnpm dev:api                          # http://localhost:4000  (API docs: /api/docs)
pnpm dev:web                          # http://localhost:3000
```

Demo mode writes outgoing email to a local inbox: `GET http://localhost:4000/api/v1/dev/mailbox?to=<email>`.
Synthetic member `DEMO-0001` has contact `member0001@example.test`.

Create the first real super administrator (no default admin exists):

```bash
pnpm --filter @dnki/api admin:create -- --email you@example.org --name "Full Name"
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test     # tests need PostgreSQL at TEST_DATABASE_URL (default postgres://postgres@localhost:5432/dnki_test)
pnpm --filter @dnki/web build
```

## Key documents

- [Implementation status & open decisions](docs/IMPLEMENTATION_STATUS.md)
- [System architecture](docs/SYSTEM_ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Database schema](docs/DATABASE_SCHEMA.md)
- [Payment integration](docs/PAYMENT_INTEGRATION.md) · [Membership integration](docs/MEMBERSHIP_INTEGRATION.md) · [Streaming security](docs/STREAMING_SECURITY.md)
- [Accreditation operations / event-day manual](docs/ACCREDITATION_OPERATIONS.md) · [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [Incident response](docs/INCIDENT_RESPONSE.md) · [Disaster recovery](docs/DISASTER_RECOVERY.md) · [Test plan](docs/TEST_PLAN.md) · [Go-live checklist](docs/GO_LIVE_CHECKLIST.md)
