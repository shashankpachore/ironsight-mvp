-- Add lifecycle status before creating indexes that depend on it.
CREATE TYPE "DealStatus" AS ENUM ('ACTIVE', 'EXPIRED');

ALTER TABLE "Deal" ADD COLUMN "status" "DealStatus" NOT NULL DEFAULT 'ACTIVE';

-- Critical indexes for high-frequency pipeline, today, and interaction log reads.
CREATE INDEX "User_managerId_role_idx" ON "User"("managerId", "role");

CREATE INDEX "Account_assignedToId_createdAt_idx" ON "Account"("assignedToId", "createdAt");

CREATE INDEX "Deal_status_createdAt_idx" ON "Deal"("status", "createdAt");
CREATE INDEX "Deal_status_lastActivityAt_idx" ON "Deal"("status", "lastActivityAt");
CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");

CREATE INDEX "InteractionLog_dealId_createdAt_idx" ON "InteractionLog"("dealId", "createdAt");
