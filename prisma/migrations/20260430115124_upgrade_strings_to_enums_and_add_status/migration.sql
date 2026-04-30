/*
  WARNINGS RESOLVED:
  - We have replaced all destructive DROP COLUMN operations with safe ALTER COLUMN ... TYPE ... USING casts.
  - This preserves all existing string data and converts it directly into the new Enums.
*/

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REP', 'MANAGER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SCHOOL', 'PARTNER');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'ACCOUNT', 'DEAL', 'LOG');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('CALL', 'ONLINE_MEETING', 'OFFLINE_MEETING');

-- CreateEnum
CREATE TYPE "StakeholderType" AS ENUM ('INFLUENCER', 'DECISION_MAKER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('MET_INFLUENCER', 'MET_DECISION_MAKER', 'BUDGET_DISCUSSED', 'DEMO_DONE', 'PRICING_REQUESTED', 'PROPOSAL_SHARED', 'BUDGET_CONFIRMED', 'NEGOTIATION_STARTED', 'DEAL_CONFIRMED', 'PO_RECEIVED', 'NO_RESPONSE', 'FOLLOW_UP_DONE', 'INTERNAL_DISCUSSION', 'DECISION_DELAYED', 'DECISION_MAKER_UNAVAILABLE', 'BUDGET_NOT_AVAILABLE', 'DEAL_ON_HOLD', 'LOST_TO_COMPETITOR', 'DEAL_DROPPED');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('NO_ACCESS_TO_DM', 'STUCK_WITH_INFLUENCER', 'BUDGET_NOT_DISCUSSED', 'BUDGET_NOT_CONFIRMED', 'BUDGET_INSUFFICIENT', 'COMPETITOR_INVOLVED', 'COMPETITOR_PREFERRED', 'DECISION_DELAYED', 'LOW_PRODUCT_FIT', 'FEATURE_GAP', 'CHAMPION_NOT_STRONG', 'INTERNAL_ALIGNMENT_MISSING');


-- AlterTable: Account
ALTER TABLE "Account" ADD COLUMN "requestedById" TEXT;

ALTER TABLE "Account" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "status" TYPE "AccountStatus" USING "status"::text::"AccountStatus";
ALTER TABLE "Account" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "Account" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "type" TYPE "AccountType" USING "type"::text::"AccountType";
ALTER TABLE "Account" ALTER COLUMN "type" SET DEFAULT 'SCHOOL';


-- AlterTable: AuditLog
ALTER TABLE "AuditLog" ALTER COLUMN "entityType" TYPE "AuditEntityType" USING "entityType"::text::"AuditEntityType";
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction" USING "action"::text::"AuditAction";


-- AlterTable: Deal (Only additions, completely safe)
ALTER TABLE "Deal" 
ADD COLUMN "coOwnerId" TEXT,
ADD COLUMN "nextStepDate" TIMESTAMP(3),
ADD COLUMN "nextStepSource" TEXT,
ADD COLUMN "nextStepType" TEXT;


-- AlterTable: InteractionLog
ALTER TABLE "InteractionLog" ALTER COLUMN "interactionType" TYPE "InteractionType" USING "interactionType"::text::"InteractionType";
ALTER TABLE "InteractionLog" ALTER COLUMN "outcome" TYPE "Outcome" USING "outcome"::text::"Outcome";
ALTER TABLE "InteractionLog" ALTER COLUMN "stakeholderType" TYPE "StakeholderType" USING "StakeholderType" USING "stakeholderType"::text::"StakeholderType";


-- AlterTable: InteractionRisk
ALTER TABLE "InteractionRisk" ALTER COLUMN "category" TYPE "RiskCategory" USING "category"::text::"RiskCategory";


-- AlterTable: User
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::text::"UserRole";


-- CreateTable: InteractionLogParticipant
CREATE TABLE "InteractionLogParticipant" (
    "logId" TEXT NOT NULL,
    "userId" TEXT NOT NULL
);

-- CreateTable: PipelineSnapshot
CREATE TABLE "PipelineSnapshot" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "dealCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- Indexes & Constraints
CREATE INDEX "InteractionLogParticipant_userId_logId_idx" ON "InteractionLogParticipant"("userId", "logId");
CREATE UNIQUE INDEX "InteractionLogParticipant_logId_userId_key" ON "InteractionLogParticipant"("logId", "userId");

CREATE INDEX "PipelineSnapshot_month_ownerId_idx" ON "PipelineSnapshot"("month", "ownerId");
CREATE UNIQUE INDEX "PipelineSnapshot_month_ownerId_stage_key" ON "PipelineSnapshot"("month", "ownerId", "stage");

CREATE INDEX "Deal_coOwnerId_idx" ON "Deal"("coOwnerId");
CREATE INDEX "User_managerId_role_idx" ON "User"("managerId", "role");

ALTER TABLE "Account" ADD CONSTRAINT "Account_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_coOwnerId_fkey" FOREIGN KEY ("coOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InteractionLogParticipant" ADD CONSTRAINT "InteractionLogParticipant_logId_fkey" FOREIGN KEY ("logId") REFERENCES "InteractionLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionLogParticipant" ADD CONSTRAINT "InteractionLogParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineSnapshot" ADD CONSTRAINT "PipelineSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;