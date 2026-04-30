/*
  WARNINGS RESOLVED:
  - Using PL/pgSQL DO blocks to ensure Enums are gracefully skipped if they already survived the previous rollback.
  - Safe ALTER COLUMN ... TYPE ... USING casts for data preservation.
*/

-- Idempotent Enum Creation
DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REP', 'MANAGER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AccountType" AS ENUM ('SCHOOL', 'PARTNER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'ACCOUNT', 'DEAL', 'LOG'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "InteractionType" AS ENUM ('CALL', 'ONLINE_MEETING', 'OFFLINE_MEETING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "StakeholderType" AS ENUM ('INFLUENCER', 'DECISION_MAKER', 'UNKNOWN'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "Outcome" AS ENUM ('MET_INFLUENCER', 'MET_DECISION_MAKER', 'BUDGET_DISCUSSED', 'DEMO_DONE', 'PRICING_REQUESTED', 'PROPOSAL_SHARED', 'BUDGET_CONFIRMED', 'NEGOTIATION_STARTED', 'DEAL_CONFIRMED', 'PO_RECEIVED', 'NO_RESPONSE', 'FOLLOW_UP_DONE', 'INTERNAL_DISCUSSION', 'DECISION_DELAYED', 'DECISION_MAKER_UNAVAILABLE', 'BUDGET_NOT_AVAILABLE', 'DEAL_ON_HOLD', 'LOST_TO_COMPETITOR', 'DEAL_DROPPED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RiskCategory" AS ENUM ('NO_ACCESS_TO_DM', 'STUCK_WITH_INFLUENCER', 'BUDGET_NOT_DISCUSSED', 'BUDGET_NOT_CONFIRMED', 'BUDGET_INSUFFICIENT', 'COMPETITOR_INVOLVED', 'COMPETITOR_PREFERRED', 'DECISION_DELAYED', 'LOW_PRODUCT_FIT', 'FEATURE_GAP', 'CHAMPION_NOT_STRONG', 'INTERNAL_ALIGNMENT_MISSING'); EXCEPTION WHEN duplicate_object THEN null; END $$;


-- AlterTable: Account
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "requestedById" TEXT;

ALTER TABLE "Account" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "status" TYPE "AccountStatus" USING "status"::text::"AccountStatus";
ALTER TABLE "Account" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "Account" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "type" TYPE "AccountType" USING "type"::text::"AccountType";
ALTER TABLE "Account" ALTER COLUMN "type" SET DEFAULT 'SCHOOL';


-- AlterTable: AuditLog
ALTER TABLE "AuditLog" ALTER COLUMN "entityType" TYPE "AuditEntityType" USING "entityType"::text::"AuditEntityType";
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction" USING "action"::text::"AuditAction";


-- AlterTable: Deal
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "coOwnerId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "nextStepDate" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "nextStepSource" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "nextStepType" TEXT;


-- AlterTable: InteractionLog
ALTER TABLE "InteractionLog" ALTER COLUMN "interactionType" TYPE "InteractionType" USING "interactionType"::text::"InteractionType";
ALTER TABLE "InteractionLog" ALTER COLUMN "outcome" TYPE "Outcome" USING "outcome"::text::"Outcome";
ALTER TABLE "InteractionLog" ALTER COLUMN "stakeholderType" TYPE "StakeholderType" USING "stakeholderType"::text::"StakeholderType";


-- AlterTable: InteractionRisk
ALTER TABLE "InteractionRisk" ALTER COLUMN "category" TYPE "RiskCategory" USING "category"::text::"RiskCategory";


-- AlterTable: User
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::text::"UserRole";


-- CreateTable: InteractionLogParticipant
CREATE TABLE IF NOT EXISTS "InteractionLogParticipant" (
    "logId" TEXT NOT NULL,
    "userId" TEXT NOT NULL
);

-- CreateTable: PipelineSnapshot
CREATE TABLE IF NOT EXISTS "PipelineSnapshot" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "dealCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "InteractionLogParticipant_userId_logId_idx" ON "InteractionLogParticipant"("userId", "logId");
CREATE UNIQUE INDEX IF NOT EXISTS "InteractionLogParticipant_logId_userId_key" ON "InteractionLogParticipant"("logId", "userId");

CREATE INDEX IF NOT EXISTS "PipelineSnapshot_month_ownerId_idx" ON "PipelineSnapshot"("month", "ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineSnapshot_month_ownerId_stage_key" ON "PipelineSnapshot"("month", "ownerId", "stage");

CREATE INDEX IF NOT EXISTS "Deal_coOwnerId_idx" ON "Deal"("coOwnerId");
CREATE INDEX IF NOT EXISTS "User_managerId_role_idx" ON "User"("managerId", "role");

-- Foreign Keys (Safely dropping and re-adding to avoid duplication errors)
ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_requestedById_fkey";
ALTER TABLE "Account" ADD CONSTRAINT "Account_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deal" DROP CONSTRAINT IF EXISTS "Deal_coOwnerId_fkey";
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_coOwnerId_fkey" FOREIGN KEY ("coOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InteractionLogParticipant" DROP CONSTRAINT IF EXISTS "InteractionLogParticipant_logId_fkey";
ALTER TABLE "InteractionLogParticipant" ADD CONSTRAINT "InteractionLogParticipant_logId_fkey" FOREIGN KEY ("logId") REFERENCES "InteractionLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InteractionLogParticipant" DROP CONSTRAINT IF EXISTS "InteractionLogParticipant_userId_fkey";
ALTER TABLE "InteractionLogParticipant" ADD CONSTRAINT "InteractionLogParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PipelineSnapshot" DROP CONSTRAINT IF EXISTS "PipelineSnapshot_ownerId_fkey";
ALTER TABLE "PipelineSnapshot" ADD CONSTRAINT "PipelineSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;