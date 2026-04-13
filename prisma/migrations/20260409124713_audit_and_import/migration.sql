-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (Postgres: add columns without SQLite table swap)
ALTER TABLE "Account" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'SCHOOL';
ALTER TABLE "Account" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Account" ADD COLUMN "district" TEXT NOT NULL DEFAULT 'UNKNOWN';
