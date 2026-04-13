import { addDaysYmd, formatYmdInIST } from "@/lib/ist-time";
import { type OutcomeValue, type RiskCategoryValue } from "@/lib/domain";
import { type NextStepTypeValue } from "@/lib/next-step";

type SuggestedNextStepValue =
  | NextStepTypeValue
  | "SCHEDULE_DM_MEETING"
  | "RESCHEDULE"
  | "PARK_DEAL"
  | "FOLLOW_UP_LATER"
  | "CLOSE_LOST";

export const NEXT_STEP_SUGGESTIONS: Record<OutcomeValue, SuggestedNextStepValue | null> = {
  MET_INFLUENCER: "SCHEDULE_DM_MEETING",
  MET_DECISION_MAKER: "SCHEDULE_DEMO",
  DEMO_DONE: "SEND_PRICING",
  PRICING_REQUESTED: "SEND_PRICING",
  BUDGET_DISCUSSED: "SEND_PROPOSAL",
  BUDGET_CONFIRMED: "SEND_PROPOSAL",
  PROPOSAL_SHARED: "FOLLOW_UP",
  NEGOTIATION_STARTED: "FOLLOW_UP",
  DEAL_CONFIRMED: "CLOSE_DEAL",
  PO_RECEIVED: null,
  NO_RESPONSE: "FOLLOW_UP",
  FOLLOW_UP_DONE: "FOLLOW_UP",
  INTERNAL_DISCUSSION: "FOLLOW_UP",
  DECISION_DELAYED: "FOLLOW_UP",
  DECISION_MAKER_UNAVAILABLE: "RESCHEDULE",
  BUDGET_NOT_AVAILABLE: "PARK_DEAL",
  DEAL_ON_HOLD: "FOLLOW_UP_LATER",
  LOST_TO_COMPETITOR: "CLOSE_LOST",
  DEAL_DROPPED: "CLOSE_LOST",
};

export const RISK_SUGGESTIONS: Partial<Record<OutcomeValue, RiskCategoryValue[]>> = {
  MET_INFLUENCER: ["NO_ACCESS_TO_DM"],
  DEMO_DONE: ["BUDGET_NOT_CONFIRMED"],
  PROPOSAL_SHARED: ["DECISION_DELAYED"],
  NO_RESPONSE: ["DECISION_DELAYED"],
};

function normalizeSuggestedNextStep(value: SuggestedNextStepValue | null): NextStepTypeValue | null {
  if (value == null) return null;
  switch (value) {
    case "SCHEDULE_DM_MEETING":
    case "RESCHEDULE":
      return "SCHEDULE_MEETING";
    case "PARK_DEAL":
    case "FOLLOW_UP_LATER":
      return "AWAIT_RESPONSE";
    case "CLOSE_LOST":
      return "CLOSE_DEAL";
    default:
      return value;
  }
}

export function getSuggestedNextStepType(outcome: OutcomeValue): NextStepTypeValue | null {
  return normalizeSuggestedNextStep(NEXT_STEP_SUGGESTIONS[outcome]);
}

export function getSuggestedNextStepDate(outcome: OutcomeValue, now: Date = new Date()): string {
  const todayYmd = formatYmdInIST(now);
  if (outcome === "PROPOSAL_SHARED" || outcome === "PRICING_REQUESTED") {
    return addDaysYmd(todayYmd, 1);
  }
  if (outcome === "NO_RESPONSE" || outcome === "FOLLOW_UP_DONE") {
    return addDaysYmd(todayYmd, 3);
  }
  return addDaysYmd(todayYmd, 2);
}
