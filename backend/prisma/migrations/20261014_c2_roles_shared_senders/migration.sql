-- Add role to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';

-- Add min_delay_seconds and is_shared to senders
ALTER TABLE "senders" ADD COLUMN IF NOT EXISTS "min_delay_seconds" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "senders" ADD COLUMN IF NOT EXISTS "is_shared" BOOLEAN NOT NULL DEFAULT true;

-- Bootstrap existing senders as shared
UPDATE "senders" SET "is_shared" = true WHERE "is_shared" IS NULL;

-- Bootstrap first user as admin if users exist
UPDATE "users"
SET "role" = 'admin'
WHERE "id" = (
  SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1
);
