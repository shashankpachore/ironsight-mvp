import type { DealStage, OutcomeValue } from "@/lib/domain";

const EVALUATION_OUTCOMES: OutcomeValue[] = [
  "DEMO_DONE",
  "PRICING_REQUESTED",
  "PROPOSAL_SHARED",
  "BUDGET_CONFIRMED",
  "NEGOTIATION_STARTED",
];

const LOSS_OUTCOMES = new Set<OutcomeValue>(["LOST_TO_COMPETITOR", "DEAL_DROPPED"]);

export function getDealStageFromOutcomes(outcomesInput: OutcomeValue[]): DealStage {
  const outcomes = new Set(outcomesInput);
  const hasDecisionMaker = outcomes.has("MET_DECISION_MAKER");
  const hasBudgetDiscussed = outcomes.has("BUDGET_DISCUSSED");
  const hasProposalShared = outcomes.has("PROPOSAL_SHARED");
  const hasDealConfirmed = outcomes.has("DEAL_CONFIRMED");
  const hasPoReceived = outcomes.has("PO_RECEIVED");
  if (hasDealConfirmed && hasPoReceived) return "CLOSED";
  if (outcomes.has("LOST_TO_COMPETITOR") || outcomes.has("DEAL_DROPPED")) {
    return "LOST";
  }

  if (hasDecisionMaker && hasBudgetDiscussed && hasProposalShared && hasDealConfirmed) {
    return "COMMITTED";
  }

  if (EVALUATION_OUTCOMES.some((outcome) => outcomes.has(outcome))) return "EVALUATION";

  if (hasDecisionMaker && hasBudgetDiscussed) {
    return "QUALIFIED";
  }

  return "ACCESS";
}

export function stageBeforeLoss(outcomes: OutcomeValue[]): DealStage {
  const lossIndex = outcomes.findIndex((outcome) => LOSS_OUTCOMES.has(outcome));
  if (lossIndex < 0) return getDealStageFromOutcomes(outcomes);
  return getDealStageFromOutcomes(outcomes.slice(0, lossIndex));
}
