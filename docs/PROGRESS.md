# Project Progress Tracker

## Current Phase: Phase 4 Completed -> Production-Grade Ready

### High-Level Architecture & Decisions
- **Stack Choice**: Node.js 24, Express, TypeScript (strict), Zod, pino, Prisma ORM.
- **Frontend Stack**: React 19, Vite 8, TypeScript (strict), Tailwind CSS v4, Lucide React, PapaParse.
- **Design System**: Exact pixel-perfect match to Figma Outbox Labs assignment (`https://www.figma.com/design/kOTwGlESjijCYnMgtHfvfU/Outbox-Labs-Assignment?node-id=59-4050&p=f&m=dev`):
  - Brand Palette: Emerald Green (`#00A340`), Soft Mint (`#E5F4EC`), Amber/Peach (`#FFE8D6`, text `#D96B27`), Crisp White and Grays (`#F4F6F5`).
  - Typography: Modern Inter sans-serif with pixel monogram `ONB` brand header.
- **Queue & Storage**: BullMQ with Redis (AOF enabled, persistent Docker volume).
- **Search**: Elasticsearch 8.x in Docker Compose with resilient PostgreSQL fallback hydration.
- **Database & Auth**: Supabase Postgres (hosted) with Row-Level Security (RLS) deny-by-default, Supabase JWT verification on Express backend, automatic user upsert, and turnkey test/demo persona ("Oliver Brown").
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
| `VITE_SUPABASE_URL` | Frontend Supabase Project URL | Phase 4 | Verified / Active |
| `VITE_SUPABASE_ANON_KEY` | Frontend Supabase Anon Key | Phase 4 | Configured |

---

## Phase Status Overview

- [x] **Phase 1: Foundation, Auth, Senders**: Completed (22/22 tests passing).
- [x] **Phase 2: Scheduling Core, Queue, Persistence**: Completed (42/42 tests passing).
- [x] **Phase 3: Rate Limiting, Slack, Elasticsearch, Queue Dashboard**: Completed (61/61 tests passing).
- [x] **Phase 4: Frontend Dashboard (React + TypeScript + Tailwind)**: Completed (6/6 tests passing, 67/67 cumulative passing).

---

## Test Inventory (Cumulative: 67 Tests, 100% Pass)

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

### Phase 3 Tests (19 Tests)
- `tests/unit/rate-limiter.lua.test.ts` (4 tests)
- `tests/integration/slack.oauth.test.ts` (5 tests)
- `tests/integration/elasticsearch.search.test.ts` (2 tests)
- `tests/integration/admin.dashboard.test.ts` (3 tests)
- `tests/e2e/phase3.e2e.test.ts` (5 tests)

### Phase 4 Tests (6 Tests)
- `frontend/tests/components.test.tsx` (6 tests)
  - `LoginPage` renders matching Figma screenshot #1 (Google button, email/password, green button)
  - `Sidebar` renders ONB logo, Oliver Brown user card, Compose button, Scheduled & Sent tabs with badges (screenshot #2 & #3)
  - `EmailList` renders scheduled emails with peach clock pill badge `(clock) Tue 9:15:12 AM`
  - `EmailList` renders sent emails with gray `Sent` badge and preview links
  - `TopSearchBar` renders search pill with filter/refresh actions and live debounced query
  - `EmailDetailModal` renders thread view with subject, callout box, and attachment cards (screenshot #4)

---

## Reproduce Commands

```bash
# Run backend test suite (Phases 1-3)
cd backend && npm test

# Run frontend component test suite (Phase 4)
cd frontend && npm test

# Run 1,000 email load simulation
cd backend && npm run load:1000

# Build backend and frontend
cd backend && npm run build
cd frontend && npm run build

# Start services locally
# Terminal 1: Backend API & Worker
cd backend && npm run dev

# Terminal 2: Frontend Dashboard (Vite on :5173 with proxy to :4000)
cd frontend && npm run dev
```
