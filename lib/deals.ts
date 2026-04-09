import { Outcome } from "@prisma/client";
import { prisma } from "./prisma";
import type { DealStage } from "./domain";

const EVALUATION_OUTCOMES: Outcome[] = [
  Outcome.DEMO_DONE,
  Outcome.PRICING_REQUESTED,
  Outcome.PROPOSAL_SHARED,
  Outcome.BUDGET_CONFIRMED,
  Outcome.NEGOTIATION_STARTED,
];

export async function getDealStage(dealId: string): Promise<DealStage> {
  const logs = await prisma.interactionLog.findMany({
    where: { dealId },
    select: { outcome: true },
  });

  const outcomes = new Set(logs.map((log) => log.outcome));
  const hasDecisionMaker = outcomes.has(Outcome.MET_DECISION_MAKER);
  const hasBudgetDiscussed = outcomes.has(Outcome.BUDGET_DISCUSSED);
  const hasProposalShared = outcomes.has(Outcome.PROPOSAL_SHARED);
  const hasDealConfirmed = outcomes.has(Outcome.DEAL_CONFIRMED);
  const hasPoReceived = outcomes.has(Outcome.PO_RECEIVED);
  const hasNegativeOutcome =
    outcomes.has(Outcome.DEAL_DROPPED) || outcomes.has(Outcome.LOST_TO_COMPETITOR);

  if (hasNegativeOutcome) return "ACCESS";

  if (hasDealConfirmed && hasPoReceived) return "CLOSED";

  if (hasDecisionMaker && hasBudgetDiscussed && hasProposalShared && hasDealConfirmed) {
    return "COMMITTED";
  }

  if (EVALUATION_OUTCOMES.some((outcome) => outcomes.has(outcome))) return "EVALUATION";

  if (hasDecisionMaker && hasBudgetDiscussed) {
    return "QUALIFIED";
  }

  return "ACCESS";
}

export async function getMissingSignals(dealId: string): Promise<string[]> {
  const [deal, logs] = await Promise.all([
    prisma.deal.findUnique({
      where: { id: dealId },
      select: { lastActivityAt: true },
    }),
    prisma.interactionLog.findMany({
      where: { dealId },
      select: { outcome: true },
    }),
  ]);

  if (!deal) {
    return [];
  }

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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (deal.lastActivityAt < sevenDaysAgo) {
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
