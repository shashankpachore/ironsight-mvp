import { Outcome } from "@prisma/client";
import { prisma } from "./prisma";
import type { DealStage, OutcomeValue } from "./domain";
export { getExpiryWarning, isDealExpired } from "./expiry";
export { getDealStageFromOutcomes, stageBeforeLoss } from "./logic/stage";
import { getDealStageFromOutcomes } from "./logic/stage";

type StageLogInput = {
  outcome: Outcome | OutcomeValue;
};

export async function getDealStage(dealId: string): Promise<DealStage> {
  const logs = await prisma.interactionLog.findMany({
    where: { dealId },
    select: { outcome: true },
  });

  return getDealStageFromOutcomes(logs.map((log) => log.outcome as OutcomeValue));
}

export function getDealStageFromLogs(logs: StageLogInput[]): DealStage {
  return getDealStageFromOutcomes(logs.map((log) => log.outcome as OutcomeValue));
}

type MissingSignalLogInput = {
  createdAt: Date | string;
  outcome: Outcome;
};

export async function getMissingSignals(
  dealId: string,
  logs?: MissingSignalLogInput[],
): Promise<string[]> {
  const [deal, fetchedLogs] = await Promise.all([
    prisma.deal.findUnique({
      where: { id: dealId },
      select: { lastActivityAt: true },
    }),
    logs
      ? Promise.resolve<MissingSignalLogInput[]>(logs)
      : prisma.interactionLog.findMany({
          where: { dealId },
          select: { createdAt: true, outcome: true },
        }),
  ]);

  if (!deal) {
    return [];
  }

  return getMissingSignalsFromLogs(deal.lastActivityAt, fetchedLogs);
}

export function getMissingSignalsFromLogs(
  fallbackLastActivityAt: Date,
  logs: MissingSignalLogInput[],
): string[] {
  const outcomes = new Set(logs.map((log) => log.outcome));
  const missing: string[] = [];

  if (!outcomes.has(Outcome.MET_DECISION_MAKER)) {
    missing.push("Missing Decision Maker");
  }
  if (!outcomes.has(Outcome.BUDGET_DISCUSSED)) {
    missing.push("Missing Budget Discussion");
  }
  if (!outcomes.has(Outcome.PROPOSAL_SHARED)) {
    missing.push("Missing Proposal");
  }

  const latestLogAt =
    logs.length > 0
      ? new Date(
          Math.max(...logs.map((log) => new Date(log.createdAt).getTime())),
        )
      : null;
  const lastActivityAt = latestLogAt ?? fallbackLastActivityAt;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (lastActivityAt < sevenDaysAgo) {
    missing.push("No Recent Activity (7 days)");
  }

  return missing;
}

export async function getStaleDeals() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.deal.findMany({
    where: { lastActivityAt: { lt: sevenDaysAgo } },
  });
}
