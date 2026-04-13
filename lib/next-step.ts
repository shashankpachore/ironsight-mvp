import { Outcome } from "@prisma/client";
import { addDaysYmd, formatYmdInIST, istYmdToUtcStart } from "@/lib/ist-time";

export const NEXT_STEP_TYPES = [
  "FOLLOW_UP",
  "SCHEDULE_MEETING",
  "SCHEDULE_DEMO",
  "SEND_PRICING",
  "SEND_PROPOSAL",
  "AWAIT_RESPONSE",
  "CLOSE_DEAL",
  "OTHER",
] as const;

export type NextStepTypeValue = (typeof NEXT_STEP_TYPES)[number];

export const NEXT_STEP_LABELS: Record<NextStepTypeValue, string> = {
  FOLLOW_UP: "Follow up",
  SCHEDULE_MEETING: "Schedule meeting",
  SCHEDULE_DEMO: "Schedule demo",
  SEND_PRICING: "Send pricing",
  SEND_PROPOSAL: "Send proposal",
  AWAIT_RESPONSE: "Await response",
  CLOSE_DEAL: "Close deal",
  OTHER: "Other",
};

export const NEXT_STEP_OPTIONS = NEXT_STEP_TYPES.map((value) => ({
  value,
  label: NEXT_STEP_LABELS[value],
}));

export function isValidNextStepType(value: unknown): value is NextStepTypeValue {
  return typeof value === "string" && (NEXT_STEP_TYPES as readonly string[]).includes(value);
}

export type SuggestedNextStep = {
  type: NextStepTypeValue;
  defaultDays: number;
};

/**
 * Auto-suggest next step from interaction outcome (IST calendar for default date offsets).
 */
export function getSuggestedNextStep(outcome: string): SuggestedNextStep {
  const normalized = outcome.trim().toUpperCase().replace(/\s+/g, "_");
  if (normalized === "NOT_INTERESTED") {
    return { type: "CLOSE_DEAL", defaultDays: 0 };
  }

  switch (outcome as Outcome) {
    case Outcome.MET_INFLUENCER:
      return { type: "SCHEDULE_MEETING", defaultDays: 1 };
    case Outcome.MET_DECISION_MAKER:
      return { type: "SCHEDULE_DEMO", defaultDays: 1 };
    case Outcome.DEMO_DONE:
      return { type: "SEND_PRICING", defaultDays: 1 };
    case Outcome.PRICING_REQUESTED:
      return { type: "SEND_PRICING", defaultDays: 1 };
    case Outcome.BUDGET_DISCUSSED:
      return { type: "SEND_PROPOSAL", defaultDays: 2 };
    case Outcome.BUDGET_CONFIRMED:
      return { type: "SEND_PROPOSAL", defaultDays: 2 };
    case Outcome.PROPOSAL_SHARED:
      return { type: "FOLLOW_UP", defaultDays: 2 };
    case Outcome.NEGOTIATION_STARTED:
      return { type: "FOLLOW_UP", defaultDays: 2 };
    case Outcome.DEAL_CONFIRMED:
      return { type: "CLOSE_DEAL", defaultDays: 1 };
    case Outcome.PO_RECEIVED:
      return { type: "CLOSE_DEAL", defaultDays: 0 };
    case Outcome.NO_RESPONSE:
      return { type: "FOLLOW_UP", defaultDays: 1 };
    case Outcome.FOLLOW_UP_DONE:
      return { type: "AWAIT_RESPONSE", defaultDays: 2 };
    case Outcome.INTERNAL_DISCUSSION:
      return { type: "FOLLOW_UP", defaultDays: 2 };
    case Outcome.DECISION_DELAYED:
      return { type: "FOLLOW_UP", defaultDays: 6 };
    case Outcome.DEAL_ON_HOLD:
      return { type: "FOLLOW_UP", defaultDays: 7 };
    case Outcome.BUDGET_NOT_AVAILABLE:
      return { type: "CLOSE_DEAL", defaultDays: 1 };
    case Outcome.LOST_TO_COMPETITOR:
      return { type: "CLOSE_DEAL", defaultDays: 0 };
    case Outcome.DEAL_DROPPED:
      return { type: "CLOSE_DEAL", defaultDays: 0 };
    default:
      return { type: "FOLLOW_UP", defaultDays: 2 };
  }
}

/** YYYY-MM-DD in IST for date inputs: today (IST) + defaultDays. */
export function getDefaultNextStepDateYmd(defaultDays: number, now: Date = new Date()): string {
  const todayYmd = formatYmdInIST(now);
  return addDaysYmd(todayYmd, defaultDays);
}

/** ISO string for API (start of chosen calendar day in IST). */
export function getDefaultNextStepDateIso(defaultDays: number, now?: Date): string {
  const ymd = getDefaultNextStepDateYmd(defaultDays, now);
  return istYmdToUtcStart(ymd).toISOString();
}

/** Fields to merge into POST /api/logs body for a given outcome. */
export function defaultNextStepRequestFields(outcome: string, now?: Date) {
  const { type, defaultDays } = getSuggestedNextStep(outcome);
  return {
    nextStepType: type,
    nextStepDate: getDefaultNextStepDateIso(defaultDays, now),
    nextStepSource: "AUTO" as const,
  };
}
