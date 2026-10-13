# Project Progress Tracker

## Current Phase: Phase 1 Completed -> Gate 1 Ready for Approval

### High-Level Architecture & Decisions
- **Stack Choice**: Node.js 24, Express, TypeScript (strict), Zod, pino, Prisma ORM.
- **Queue & Storage**: BullMQ with Redis (AOF enabled, persistent Docker volume).
- **Search**: Elasticsearch 8.x in Docker Compose.
- **Database & Auth**: Supabase Postgres (hosted) with Row-Level Security (RLS) deny-by-default, Supabase JWT verification on Express backend, upsert user on first request.
- **Email Dispatch Strategy**: Outbox pattern (DB transaction) -> delayed BullMQ jobs (`jobId = email:<emailId>`) -> worker conditional claim -> atomic Lua admission -> Nodemailer pooled SMTP transport -> outbox event for ES indexing.
- **Restart Persistence**: Zero in-memory timers. Redis AOF persistence with volume. Deterministic BullMQ job IDs. Single startup reconciliation for un-enqueued outbox records.
- **Idempotency**: 4-layer idempotency (Request `Idempotency-Key` table, deterministic `jobId`, conditional DB status update, deterministic Message-ID attempt tracking).

---

## Environment Variables Inventory

| Variable | Description | Phase Added | Status |
|---|---|---|---|
| `PORT` | API server port (default: 4000) | Phase 1 | Verified / Active |
| `NODE_ENV` | Runtime environment (`development`, `test`, `production`) | Phase 1 | Verified / Active |
| `LOG_LEVEL` | Pino logging level (`info`, `debug`, etc.) | Phase 1 | Verified / Active |
| `DATABASE_URL` | Direct Supabase Postgres connection string | Phase 1 | Setup in .env |
| `SUPABASE_URL` | Supabase project URL (`https://<project>.supabase.co`) | Phase 1 | Setup in .env |
| `SUPABASE_ANON_KEY` | Supabase anon public API key | Phase 1 | Setup in .env |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role secret key | Phase 1 | Setup in .env |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret for backend token verification | Phase 1 | Verified / Active |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of SMTP & Slack credentials | Phase 1 | Verified / Active |
| `REDIS_HOST` | Redis host (default: `localhost`) | Phase 1 | Active |
| `REDIS_PORT` | Redis port (default: `6379`) | Phase 1 | Active |
| `REDIS_PASSWORD` | Redis password | Phase 1 | Optional |
| `ELASTICSEARCH_NODE` | Elasticsearch URL (default: `http://localhost:9200`) | Phase 1 | Active |
| `WORKER_CONCURRENCY` | BullMQ worker concurrency | Phase 2 | Planned (default 5) |
| `SLACK_CLIENT_ID` | Slack OAuth client ID | Phase 3 | Needed in Phase 3 |
| `SLACK_CLIENT_SECRET` | Slack OAuth client secret | Phase 3 | Needed in Phase 3 |
| `SLACK_SIGNING_SECRET` | Slack signing secret | Phase 3 | Needed in Phase 3 |
| `SLACK_REDIRECT_URI` | Slack OAuth redirect URL | Phase 3 | Needed in Phase 3 |

---

## Phase Status Overview

- [x] **Phase 1: Foundation, Auth, Senders**: Completed (22/22 tests passing).
- [ ] **Phase 2: Scheduling Core, Queue, Persistence**: Ready to start upon user approval.
- [ ] **Phase 3: Rate Limiting, Slack, Elasticsearch, Queue Dashboard**: Pending Phase 2 gate.
- [ ] **Phase 4: Frontend (React + TypeScript + Tailwind)**: Pending Phase 3 gate.

---

## Test Inventory (Cumulative)

### Phase 1: 22 Tests (100% Pass)
- `tests/unit/env.test.ts` (4 tests)
  - Validates correct environment schema
  - Rejects missing DATABASE_URL
  - Enforces 64-hex-char encryption key constraint
  - Rejects short Supabase JWT secrets (<16 chars)
- `tests/unit/crypto.test.ts` (5 tests)
  - AES-256-GCM roundtrip encryption and decryption
  - Random IV ensures unique ciphertexts for identical plaintext
  - Throws on tampered ciphertext
  - Throws on tampered authentication tag
  - Validates encryption key length
- `tests/unit/jwt.test.ts` (4 tests)
  - Mints and verifies valid Supabase token
  - Rejects expired token
  - Rejects invalid signature
  - Rejects wrong audience (`aud != 'authenticated'`)
- `tests/integration/sender.api.test.ts` (4 tests)
  - Rejects unauthenticated requests with 401 UNAUTHORIZED
  - Rejects invalid payload with 400 VALIDATION_ERROR
  - Rejects unreachable SMTP server with 400 INVALID_SMTP_CREDENTIALS
  - Strict tenant isolation: User A senders are invisible to User B
- `tests/e2e/phase1.e2e.test.ts` (5 tests)
  - Step 1: Health check endpoint checks Postgres, Redis, and ES
  - Step 2: Generates 2 real Ethereal SMTP accounts and registers them for User A
  - Step 3: User A lists senders and sees both
  - Step 4: User B lists senders and sees none
  - Step 5: Bad SMTP credentials rejected with 400 INVALID_SMTP_CREDENTIALS

---

## Reproduce Commands
```bash
# Run all tests
cd backend && npm test

# Run Phase 1 E2E suite
cd backend && npm run e2e:phase1

# Compile TypeScript
cd backend && npm run build
```
