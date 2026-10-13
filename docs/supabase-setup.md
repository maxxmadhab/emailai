# Supabase & Auth Setup Guide

This guide walks you through setting up Supabase, Google OAuth provider, database configuration, and environment variables for the ReachInbox Email Scheduler.

---

## 1. Create a Supabase Project

1. Log in to [Supabase Console](https://supabase.com/dashboard).
2. Click **New Project**.
3. Select an organization, give your project a name (e.g., `reachinbox-scheduler`), choose a database password (save this password securely), and pick your nearest region.
4. Wait for the project initialization to complete.

---

## 2. Obtain Connection Strings & API Keys

Navigate to **Project Settings** in your Supabase dashboard:

### Database Connection Strings (`Project Settings` -> `Database`)
- **Direct Connection / Session Pooler (Port 5432 or 6543 Session mode)**:
  - Required for Prisma migrations and BullMQ worker.
  - Format: `postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres` (or direct host port 5432).
  - Variable: `DATABASE_URL`

### API Keys (`Project Settings` -> `API`)
- **Project URL**: `https://<project-ref>.supabase.co` (`SUPABASE_URL`)
- **anon public key**: Used for frontend client-side calls (`SUPABASE_ANON_KEY`)
- **service_role secret key**: Used for server-side administrative tasks (`SUPABASE_SERVICE_ROLE_KEY`)
- **JWT Secret**: Found under `Project Settings` -> `API` -> `JWT Settings` -> `JWT Secret` (`SUPABASE_JWT_SECRET`). Express uses this to verify Supabase bearer tokens.

---

## 3. Configure Google OAuth Provider

### Step 3.1: Create Google Cloud OAuth Client
1. Visit [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Configure OAuth consent screen:
   - User Type: **External**.
   - App Name: `ReachInbox Scheduler`.
   - Developer contact email: your email.
3. Under **Credentials** -> **Create Credentials** -> **OAuth client ID**:
   - Application type: **Web application**.
   - Name: `ReachInbox Supabase Client`.
   - **Authorized redirect URIs**:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`

### Step 3.2: Enable Google Provider in Supabase
1. In Supabase Dashboard, go to **Authentication** -> **Providers** -> **Google**.
2. Toggle Google to **Enabled**.
3. Enter:
   - **Client ID**: From Google Cloud Console.
   - **Client Secret**: From Google Cloud Console.
4. Save the configuration.

### Step 3.3: Set Auth Redirect URLs
1. In Supabase Dashboard, go to **Authentication** -> **URL Configuration**.
2. Set **Site URL** to: `http://localhost:5173` (Vite dev server).
3. Add **Redirect URLs**:
   - `http://localhost:5173/**`
   - `http://localhost:4000/**`

---

## 4. Run Migrations

The database migration SQL files are located in `/backend/prisma/migrations/` (or run via Prisma CLI):
```bash
cd backend
npx prisma migrate deploy
```
This sets up all tables with primary keys, indexes, foreign keys, and RLS deny-by-default policies.
