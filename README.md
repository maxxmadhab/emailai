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

## 📋 Phase Roadmap
- [x] **Phase 1: Foundation, Auth, Senders** (Completed)
- [ ] **Phase 2: Scheduling Core, Queue, Persistence** (Ready to begin)
- [ ] **Phase 3: Rate Limiting, Slack, Elasticsearch, Queue Dashboard**
- [ ] **Phase 4: Frontend (React + TypeScript + Tailwind)**
