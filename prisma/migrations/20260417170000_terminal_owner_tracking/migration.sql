-- CreateEnum
CREATE TYPE "DealTerminalStage" AS ENUM ('CLOSED', 'LOST');

-- AlterTable
ALTER TABLE "Deal"
ADD COLUMN "terminalOwnerId" TEXT,
ADD COLUMN "terminalStage" "DealTerminalStage";

-- AddForeignKey
ALTER TABLE "Deal"
ADD CONSTRAINT "Deal_terminalOwnerId_fkey"
FOREIGN KEY ("terminalOwnerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill terminal ownership for existing terminal deals.
WITH stage_by_deal AS (
  SELECT
    d.id AS deal_id,
    CASE
      WHEN
        BOOL_OR(l.outcome = 'DEAL_CONFIRMED') AND
        BOOL_OR(l.outcome = 'PO_RECEIVED')
      THEN 'CLOSED'::"DealTerminalStage"
      WHEN
        BOOL_OR(l.outcome = 'LOST_TO_COMPETITOR') OR
        BOOL_OR(l.outcome = 'DEAL_DROPPED')
      THEN 'LOST'::"DealTerminalStage"
      ELSE NULL
    END AS stage
  FROM "Deal" d
  LEFT JOIN "InteractionLog" l ON l."dealId" = d.id
  GROUP BY d.id
)
UPDATE "Deal" d
SET
  "terminalStage" = s.stage,
  "terminalOwnerId" = d."ownerId"
FROM stage_by_deal s
WHERE d.id = s.deal_id
  AND s.stage IS NOT NULL
  AND d."terminalStage" IS NULL;
