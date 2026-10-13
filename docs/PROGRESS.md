# Project Progress Tracker

## Current Phase: Phase 2 Completed -> Gate 2 Ready for Approval

### High-Level Architecture & Decisions
- **Stack Choice**: Node.js 24, Express, TypeScript (strict), Zod, pino, Prisma ORM.
- **Queue & Storage**: BullMQ with Redis (AOF enabled, persistent Docker volume).
- **Search**: Elasticsearch 8.x in Docker Compose.
- **Database & Auth**: Supabase Postgres (hosted) with Row-Level Security (RLS) deny-by-default, Supabase JWT verification on Express backend, upsert user on first request.
- **Email Dispatch Strategy**: Outbox pattern (DB transaction) -> delayed BullMQ jobs (`jobId = email:<emailId>`) -> worker conditional claim -> atomic Lua admission -> Nodemailer pooled SMTP transport -> outbox event for ES indexing.
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
| `SLACK_CLIENT_ID` | Slack OAuth client ID | Phase 3 | Needed in Phase 3 |
| `SLACK_CLIENT_SECRET` | Slack OAuth client secret | Phase 3 | Needed in Phase 3 |
| `SLACK_SIGNING_SECRET` | Slack signing secret | Phase 3 | Needed in Phase 3 |
| `SLACK_REDIRECT_URI` | Slack OAuth redirect URL | Phase 3 | Needed in Phase 3 |

---

## Phase Status Overview

- [x] **Phase 1: Foundation, Auth, Senders**: Completed (22/22 tests passing).
- [x] **Phase 2: Scheduling Core, Queue, Persistence**: Completed (42/42 cumulative tests passing).
- [ ] **Phase 3: Rate Limiting, Slack, Elasticsearch, Queue Dashboard**: Pending Gate 2 approval.
- [ ] **Phase 4: Frontend (React + TypeScript + Tailwind)**: Pending Phase 3 approval.

---

## Test Inventory (Cumulative: 42 Tests, 100% Pass)

### Phase 1 Tests (22 Tests)
- `tests/unit/env.test.ts` (4 tests)
- `tests/unit/crypto.test.ts` (5 tests)
- `tests/unit/jwt.test.ts` (4 tests)
- `tests/integration/sender.api.test.ts` (4 tests)
- `tests/e2e/phase1.e2e.test.ts` (5 tests)

### Phase 2 Tests (20 New Tests -> 42 Cumulative)
- `tests/unit/recipient-parser.test.ts` (5 tests)
  - Strips UTF-8 BOM header from CSV/TXT
  - Handles CSV with quoted fields containing commas
  - Deduplicates emails within the file (case-insensitive) and reports duplicate count
  - Captures malformed email rows with line number and syntax error details
  - Parses TXT format with display names and angle brackets
- `tests/integration/idempotency.test.ts` (3 tests)
  - Rejects campaign creation without `Idempotency-Key` (400)
  - Idempotent retry returns identical cached response with zero duplicate DB rows
  - Rejects key reuse with mismatched payload (422)
- `tests/integration/campaign.api.test.ts` (4 tests)
  - Enforces tenant isolation on sender selection (cannot schedule with another user's sender)
  - Multipart CSV upload parses and creates campaign + scheduled emails
  - Paginated list queries for scheduled/sent/failed emails strictly tenant-scoped
  - Cancelling scheduled email updates DB and removes job from BullMQ
- `tests/integration/worker.lifecycle.test.ts` (3 tests)
  - Concurrency safety: conditional update (`scheduled -> processing`) prevents duplicate sends when 2 workers race
  - Outbox recovery: startup reconciliation enqueues unpublished events from interrupted runs
  - Failure handling: permanent errors mark email as failed without infinite retry loops
- `tests/e2e/phase2.e2e.test.ts` (5 tests)
  - Step 1: Provisions real Ethereal sender and verifies via Nodemailer
  - Step 2: Schedules 20 emails spaced across time with transactional outbox
  - Step 3: Cold restart simulation: workers and queues restart, jobs remain intact, zero early sends
  - Step 4: Worker dispatches jobs as they become due with real Ethereal preview URLs and message IDs
  - Step 5: Worker mid-send kill & recovery: claim lock prevents duplicate dispatch

---

## Reproduce Commands
```bash
# Run complete test suite (Phase 1 + Phase 2)
cd backend && npm test

# Run Phase 1 E2E tests
cd backend && npm run e2e:phase1

# Run Phase 2 E2E tests
cd backend && npm run e2e:phase2

# Compile TypeScript
cd backend && npm run build
```
