# Project Progress Tracker

## Current Phase: Phase 3 Completed -> Gate 3 Ready for Approval

### High-Level Architecture & Decisions
- **Stack Choice**: Node.js 24, Express, TypeScript (strict), Zod, pino, Prisma ORM.
- **Queue & Storage**: BullMQ with Redis (AOF enabled, persistent Docker volume).
- **Search**: Elasticsearch 8.x in Docker Compose with resilient PostgreSQL fallback hydration.
- **Database & Auth**: Supabase Postgres (hosted) with Row-Level Security (RLS) deny-by-default, Supabase JWT verification on Express backend, upsert user on first request.
- **Rate Limiting Engine**: Atomic Redis Lua script enforcing per-sender min delay (reserved next slots) and fixed UTC hourly quota. Over-limit jobs rescheduled into next window; first limit hit per sender per window triggers decoupled Slack alert.
- **Observability**: Protected BullMQ dashboard via `bull-board` at `/admin/queues`.
- **Restart Persistence**: Strict zero-in-memory-timer design. Redis AOF persistence with volume. Deterministic BullMQ job IDs. Single startup reconciliation for un-enqueued outbox records (`reconcileStartupOutbox()`).
- **Idempotency**: 4-layer idempotency (Request `Idempotency-Key` table, deterministic `jobId`, conditional DB status update, deterministic Message-ID attempt tracking).

---

## Environment Variables Inventory

| Variable | Description | Phase Added | Status |
|---|---|---|---|
| `PORT` | API server port (default: 4000) | Phase 1 | Verified / Active |
| `NODE_ENV` | Runtime environment (`development`, `test`, `production`) | Phase 1 | Verified / Active |
| `LOG_LEVEL` | Pino logging level (`info`, `debug`, etc.) | Phase 1 | Verified / Active |
| `DATABASE_URL` | Direct Supabase Postgres connection string | Phase 1 | Verified & Connected |
| `SUPABASE_URL` | Supabase project URL (`https://<project>.supabase.co`) | Phase 1 | Verified / Active |
| `SUPABASE_ANON_KEY` | Supabase anon public API key | Phase 1 | Configured |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role secret key | Phase 1 | Configured |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret for backend token verification | Phase 1 | Verified / Active |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of SMTP & Slack credentials | Phase 1 | Verified / Active |
| `REDIS_HOST` | Redis host (default: `localhost`) | Phase 1 | Active |
| `REDIS_PORT` | Redis port (default: `6379`) | Phase 1 | Active |
| `REDIS_PASSWORD` | Redis password | Phase 1 | Optional |
| `ELASTICSEARCH_NODE` | Elasticsearch URL (default: `http://localhost:9200`) | Phase 1 | Active |
| `WORKER_CONCURRENCY` | BullMQ worker concurrency | Phase 2 | Verified / Active (default 5) |
| `SLACK_CLIENT_ID` | Slack OAuth client ID | Phase 3 | Active in OAuth provider |
| `SLACK_CLIENT_SECRET` | Slack OAuth client secret | Phase 3 | Active in OAuth provider |
| `SLACK_SIGNING_SECRET` | Slack signing secret for state verification | Phase 3 | Active in OAuth provider |
| `SLACK_REDIRECT_URI` | Slack OAuth redirect URL | Phase 3 | Active (`/api/slack/callback`) |

---

## Phase Status Overview

- [x] **Phase 1: Foundation, Auth, Senders**: Completed (22/22 tests passing).
- [x] **Phase 2: Scheduling Core, Queue, Persistence**: Completed (42/42 tests passing).
- [x] **Phase 3: Rate Limiting, Slack, Elasticsearch, Queue Dashboard**: Completed (61/61 tests passing).
- [ ] **Phase 4: Frontend (React + TypeScript + Tailwind)**: Pending Gate 3 approval.

---

## Test Inventory (Cumulative: 61 Tests, 100% Pass)

### Phase 1 Tests (22 Tests)
- `tests/unit/env.test.ts` (4 tests)
- `tests/unit/crypto.test.ts` (5 tests)
- `tests/unit/jwt.test.ts` (4 tests)
- `tests/integration/sender.api.test.ts` (4 tests)
- `tests/e2e/phase1.e2e.test.ts` (5 tests)

### Phase 2 Tests (20 Tests)
- `tests/unit/recipient-parser.test.ts` (5 tests)
- `tests/integration/idempotency.test.ts` (3 tests)
- `tests/integration/campaign.api.test.ts` (4 tests)
- `tests/integration/worker.lifecycle.test.ts` (3 tests)
- `tests/e2e/phase2.e2e.test.ts` (5 tests)

### Phase 3 Tests (19 New Tests -> 61 Cumulative)
- `tests/unit/rate-limiter.lua.test.ts` (4 tests)
  - Enforces min-delay spacing (rejects immediate duplicate request with `SPACING_VIOLATION`)
  - Multi-sender independence: sender A quota does not affect sender B
  - Strictly caps admissions at exact limit and emits `shouldAlert` exactly ONCE across 500 over-limit requests
  - Handles UTC hour rollover boundary: resets quota at next hour window
- `tests/integration/slack.oauth.test.ts` (5 tests)
  - Cryptographic HMAC state generation and tamper detection (rejects modified payload and expired timestamp)
  - `/api/slack/connect` redirects with signed state
  - `/api/slack/connection` returns connection status
  - `/api/slack/connection` DELETE disconnects cleanly
  - Decoupled alert dispatching: unconnected Slack completes cleanly without failing email sends
- `tests/integration/elasticsearch.search.test.ts` (2 tests)
  - Search by recipient and subject with strict tenant isolation
  - Status filter parameter verification
- `tests/integration/admin.dashboard.test.ts` (3 tests)
  - Rejects unauthenticated requests to `/admin/queues` with 401 UNAUTHORIZED_ADMIN
  - Rejects invalid tokens with 401
  - Permits authenticated requests with valid Bearer token
- `tests/e2e/phase3.e2e.test.ts` (5 tests)
  - Step 1: Creates sender with strict limit of 5/hr and 2s delay
  - Step 2: Schedules 12 emails -> exactly 5 sent, 7 rescheduled to next window (zero dropped, zero failed)
  - Step 3: Slack alert decoupled behavior (not connected: no crash; connected: real message posted)
  - Step 4: Search emails via `/api/emails/search` by recipient and subject
  - Step 5: BullMQ queue admin dashboard at `/admin/queues` is protected and operational

---

## Reproduce Commands
```bash
# Run complete test suite (Phases 1-3)
cd backend && npm test

# Run Phase 1 E2E tests
cd backend && npm run e2e:phase1

# Run Phase 2 E2E persistence tests
cd backend && npm run e2e:phase2

# Run Phase 3 E2E rate limit & Slack tests
cd backend && npm run e2e:phase3

# Run 1,000 email load simulation
cd backend && npm run load:1000

# Compile TypeScript
cd backend && npm run build
```
