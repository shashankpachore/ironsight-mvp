-- Add soft-delete metadata columns for rollout safety.
-- Non-destructive: nullable columns only.
ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;

ALTER TABLE "Deal"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
