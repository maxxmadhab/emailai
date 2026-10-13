# ReachInbox Reliable Email Scheduler Service & Dashboard

A production-grade distributed email scheduler designed for outreach and drip campaigns. Built for **rock-solid reliability**: restart persistence, exactly-spaced scheduling, atomic sender rate limiting (fixed UTC hourly windows + min delays), idempotency, tenant isolation, and live observability.

---

## 🏛️ Architecture Overview

```
                      +-----------------------------+
                      |   React + Vite + Tailwind   |
                      |          (Phase 4)          |
                      +--------------+--------------+
                                     |
                       Supabase JWT  |  Idempotency-Key
                                     v
                      +-----------------------------+
                      | Express + TypeScript API     |
                      | - Zod input validation      |
                      | - Supabase JWT verification |
                      | - Tenant-scoped access      |
                      +--------------+--------------+
                                     |
             +-----------------------+-----------------------+
             | (1) Atomic Outbox Txn                         | (2) Senders AES-256-GCM
             v                                               v
+--------------------------+                   +--------------------------+
|  Supabase PostgreSQL     |                   |  Ethereal SMTP Accounts  |
|  - RLS deny-by-default   |                   |  - Multiple accounts     |
|  - Users, Senders,       |                   |  - Real Nodemailer verify|
|    Campaigns, Emails,    |                   +--------------------------+
|    Outbox, Idempotency   |
+------------+-------------+
             |
             | Outbox Dispatcher
             v
+--------------------------+
|    BullMQ + Redis        |
| - AOF + persistent vol   |
| - Deterministic job IDs  |
| - Atomic Lua admission   |
+------------+-------------+
             |
             v
+--------------------------+
|      BullMQ Worker       |
| - Conditional DB claim   |
| - Rate limit & delay slot|
| - Pooled SMTP transport  |
| - Preview URLs captured  |
+------------+-------------+
             |
             +-----------------------+-----------------------+
             | Status Outbox         | Hourly Limit Hit
             v                       v
+--------------------------+   +--------------------------+
|      Elasticsearch       |   |       Slack OAuth        |
| - Fast email search      |   | - Real webhook alerts    |
| - Tenant isolated        |   | - 1 alert/sender/window  |
+--------------------------+   +--------------------------+
```

---

## 🚀 Quick Start (Phase 1)

### Prerequisites
- Node.js >= 20.0.0
- Docker & Docker Compose (for Redis & Elasticsearch)
- Supabase Project (Postgres & Auth)

### 1. Environment Setup
Copy the example environment file and fill in your keys:
```bash
cp .env.example backend/.env
```

Ensure `CREDENTIAL_ENCRYPTION_KEY` is a 64-hex-character string (32 bytes). To generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Install Dependencies
```bash
cd backend
npm install
```

### 3. Generate Database Client & Migrations
```bash
npx prisma generate
npx prisma migrate deploy
```
*(See [`docs/supabase-setup.md`](docs/supabase-setup.md) for full Supabase database and Google OAuth instructions.)*

### 4. Run Automated Tests
```bash
# Run unit & integration tests
npm test

# Run Phase 1 E2E test (provisions real Ethereal SMTP accounts)
npm run e2e:phase1
```

### 5. Generate Real Ethereal Accounts for Testing
```bash
npm run ethereal:create
```

---

## 🔒 Security & Idempotency Principles
1. **Tenant Isolation**: Every database query is strictly scoped to the authenticated `user_id`. Senders, campaigns, and emails cannot be accessed across tenants.
2. **Secrets Protection**: SMTP passwords and Slack tokens are encrypted with AES-256-GCM using an authenticated 12-byte IV and 16-byte authentication tag. Decrypted secrets are never leaked to the client.
3. **Database Security**: Supabase tables have Row-Level Security (RLS) enabled with deny-by-default policies against the public `anon` role.
4. **Idempotency**: Four distinct layers prevent duplicate execution:
   - Request layer (`Idempotency-Key` header with DB uniqueness constraint)
   - Queue layer (Deterministic job ID: `email:<emailId>`)
   - DB claim layer (Conditional state transition `scheduled -> processing`)
   - Outbox layer (Deterministic `dedupe_key`)

---

## 📬 Ambiguous-SMTP Strategy & Reliability Guarantees
- **At-Least-Once Target**: Distributed SMTP delivery cannot offer strict exactly-once semantics because a server or network failure can occur after SMTP server accept (`250 OK`) but before local database confirmation.
- **Deterministic Message-ID**: For every scheduled email, the system assigns a deterministic `Message-ID: <emailId@reachinbox.outbox.ai>` derived from the email UUID prior to dispatch.
- **Crash Recovery**: When a worker crashes mid-transmission, recovery processes observe `attempts > 0` and inspect the deterministic Message-ID against outbox events to prevent re-sending duplicates.
- **Transactional Outbox**: All campaign insertions, email records, and outbox events occur in ONE database transaction. Delayed BullMQ jobs are dispatched asynchronously and marked published upon confirmation.
- **Restart Persistence**: No in-memory JavaScript timers or periodic DB polling loops. Jobs persist in Redis AOF storage with deterministic job IDs (`email:<emailId>`). A single one-time reconciliation at boot recovers any un-published outbox records.

---

## ⚡ Rate Limiting & Concurrency Architecture

### Fixed UTC Hourly Windows vs Rolling Windows
- **Design Choice**: Fixed UTC hourly windows (`Math.floor(now / 3600000) * 3600000`) combined with atomic min-delay slot reservation.
- **Trade-off Analysis**:
  - *Fixed Windows*: Extremely fast atomic counters in Redis, deterministic quota reset boundaries, straightforward Slack notification grouping (`senderId:windowStart`), and zero memory leak risks.
  - *Boundary Burst Trade-off*: If 50 emails are sent in the last 2 minutes of an hour (e.g. 10:58) and 50 more at the beginning of the next hour (11:00), a theoretical 100-email burst could occur.
  - *Our Solution*: We enforce **both** the fixed window AND a mandatory **atomic min-delay reservation** (e.g. min 2s between sends per sender). Even across hour rollover boundaries, the min-delay slot is preserved in Redis, strictly preventing instantaneous bursts.

### Slack Decoupled Alerting
- Real OAuth 2.0 flow with signed HMAC states (`${userId}.${timestamp}.${signature}`).
- First limit hit per sender per window triggers an alert job on `slack-notification-queue`.
- **Fault-Tolerant & Decoupled**: If Slack is not connected or the Slack API is temporarily down, background email dispatch continues completely unaffected. If the user connects Slack later, subsequent alerts trigger immediately without redeployment.

### Elasticsearch & Hybrid Search
- Strict mapping on `emails` index (`userId`, `recipient`, `subject`, `body`, `status`, `scheduledAt`, `sentAt`).
- Fully tenant-scoped (`term: { userId }`).
- **Resilient Fallback**: If the Elasticsearch cluster is offline or undergoing maintenance, searches transparently fall back to PostgreSQL full-text queries with zero user disruption.

### Protected BullMQ Admin Dashboard
- Accessible at `/admin/queues`.
- Protected by `adminAuthGuard` (requires valid authentication token; unauthenticated requests receive `401 UNAUTHORIZED_ADMIN`).

---

## 📋 Phase Roadmap
- [x] **Phase 1: Foundation, Auth, Senders** (Completed, 22 tests)
- [x] **Phase 2: Scheduling Core, Queue, Persistence** (Completed, 42 tests)
- [x] **Phase 3: Rate Limiting, Slack, Elasticsearch, Queue Dashboard** (Completed, 61 tests)
- [ ] **Phase 4: Frontend (React + TypeScript + Tailwind)** (Next)
