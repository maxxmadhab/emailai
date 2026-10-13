-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: users
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "email" TEXT NOT NULL UNIQUE,
    "name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: senders
CREATE TABLE IF NOT EXISTS "senders" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "encrypted_username" TEXT NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "hourly_limit" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_senders_user_id" ON "senders"("user_id");
CREATE INDEX IF NOT EXISTS "idx_senders_email" ON "senders"("email");

-- Table: campaigns
CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "sender_id" UUID NOT NULL REFERENCES "senders"("id") ON DELETE CASCADE,
    "name" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "delay_seconds" INTEGER NOT NULL DEFAULT 2,
    "hourly_limit" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'active',
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uq_campaigns_user_idempotency" UNIQUE ("user_id", "idempotency_key")
);
CREATE INDEX IF NOT EXISTS "idx_campaigns_user_id" ON "campaigns"("user_id");
CREATE INDEX IF NOT EXISTS "idx_campaigns_sender_id" ON "campaigns"("sender_id");

-- Table: emails
CREATE TABLE IF NOT EXISTS "emails" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "campaign_id" UUID NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "sender_id" UUID NOT NULL REFERENCES "senders"("id") ON DELETE CASCADE,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "message_id" TEXT,
    "preview_url" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_emails_user_id" ON "emails"("user_id");
CREATE INDEX IF NOT EXISTS "idx_emails_sender_id" ON "emails"("sender_id");
CREATE INDEX IF NOT EXISTS "idx_emails_status" ON "emails"("status");
CREATE INDEX IF NOT EXISTS "idx_emails_scheduled_at" ON "emails"("scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_emails_campaign_id" ON "emails"("campaign_id");

-- Table: outbox_events
CREATE TABLE IF NOT EXISTS "outbox_events" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "idx_outbox_events_status" ON "outbox_events"("status");
CREATE INDEX IF NOT EXISTS "idx_outbox_events_created_at" ON "outbox_events"("created_at");

-- Table: idempotency_keys
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "uq_idempotency_user_key" UNIQUE ("user_id", "key")
);

-- Table: slack_connections
CREATE TABLE IF NOT EXISTS "slack_connections" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
    "team_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "channel_id" TEXT,
    "channel_name" TEXT,
    "encrypted_access_token" TEXT NOT NULL,
    "encrypted_incoming_webhook" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Row Level Security (RLS) Deny-by-default on all tables
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "senders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slack_connections" ENABLE ROW LEVEL SECURITY;

-- Deny-by-default explicit policies for public / anon role
-- The backend uses the service_role / direct postgres connection which bypasses RLS,
-- but public anon access directly to Postgres via Supabase postgREST is strictly denied.
CREATE POLICY "Deny all public access to users" ON "users" FOR ALL TO anon USING (false);
CREATE POLICY "Deny all public access to senders" ON "senders" FOR ALL TO anon USING (false);
CREATE POLICY "Deny all public access to campaigns" ON "campaigns" FOR ALL TO anon USING (false);
CREATE POLICY "Deny all public access to emails" ON "emails" FOR ALL TO anon USING (false);
CREATE POLICY "Deny all public access to outbox_events" ON "outbox_events" FOR ALL TO anon USING (false);
CREATE POLICY "Deny all public access to idempotency_keys" ON "idempotency_keys" FOR ALL TO anon USING (false);
CREATE POLICY "Deny all public access to slack_connections" ON "slack_connections" FOR ALL TO anon USING (false);
