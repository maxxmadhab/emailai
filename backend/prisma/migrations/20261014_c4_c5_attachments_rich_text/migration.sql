-- Additive Migration: Attachments and Rich Text HTML Body
-- Safe, additive, backward-compatible

-- 1. Add body_html to campaigns
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "body_html" TEXT;

-- 2. Add body_html to emails
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "body_html" TEXT;

-- 3. Create attachments table
CREATE TABLE IF NOT EXISTS "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "campaign_id" UUID,
    "original_filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "attachments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL
);

-- 4. Create indices on attachments
CREATE INDEX IF NOT EXISTS "attachments_user_id_idx" ON "attachments"("user_id");
CREATE INDEX IF NOT EXISTS "attachments_campaign_id_idx" ON "attachments"("campaign_id");
