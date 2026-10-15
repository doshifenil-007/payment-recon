# Real-Time Payment Reconciliation Platform

Idempotent payment-webhook processing with a PostgreSQL-backed event log, retries with backoff, an admin force-retry, an audit trail, and live updates over Server-Sent Events.

## Quick start

Requirements: Node.js 20+, PostgreSQL 16+ (or `docker compose up -d postgres`).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # then edit the secrets
createdb payment_recon && createdb payment_recon_test

npm run db:migrate
# Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in your shell, then run:
npm run db:seed

npm run dev:api                             # terminal 1: API on :4000
npm run dev:worker                          # terminal 2: retry worker
npm run gateway -- --payments 3             # terminal 3: send signed webhooks, including a duplicate and an out-of-order event
```

Log in and inspect:

```bash
curl -c jar -H 'content-type: application/json' -d '{"email":"your-admin@example.com","password":"your-admin-password"}' localhost:4000/api/auth/login
curl -b jar localhost:4000/api/payments
curl -b jar localhost:4000/api/events
```

## Tests

Tests run against a real PostgreSQL database (`payment_recon_test`).

```bash
npm test
npm run typecheck
```

They cover: duplicate delivery, concurrent identical deliveries, invalid transitions, out-of-order events with backoff, rollback on mid-processing failure, DEAD after repeated failures, same-ID-different-payload conflicts, signature tampering and expiry, malformed JSON, and RBAC on force-retry.

## Design

See `docs/decisions/001-postgres-idempotency.md`. The short version: a unique index is the deduplication point, and each event is processed in a transaction whose status change is provisional until commit.
