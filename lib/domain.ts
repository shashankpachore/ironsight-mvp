export const INTERACTION_TYPES = ["CALL", "ONLINE_MEETING", "OFFLINE_MEETING"] as const;
export const STAKEHOLDER_TYPES = [
  "INFLUENCER",
  "DECISION_MAKER",
  "UNKNOWN",
] as const;
export const OUTCOMES = [
  "MET_INFLUENCER",
  "MET_DECISION_MAKER",
  "BUDGET_DISCUSSED",
  "DEMO_DONE",
  "PRICING_REQUESTED",
  "PROPOSAL_SHARED",
  "BUDGET_CONFIRMED",
  "NEGOTIATION_STARTED",
  "DEAL_CONFIRMED",
  "PO_RECEIVED",
  "NO_RESPONSE",
  "FOLLOW_UP_DONE",
  "INTERNAL_DISCUSSION",
  "DECISION_DELAYED",
  "DECISION_MAKER_UNAVAILABLE",
  "BUDGET_NOT_AVAILABLE",
  "DEAL_ON_HOLD",
  "LOST_TO_COMPETITOR",
  "DEAL_DROPPED",
] as const;
export type OutcomeValue = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<OutcomeValue, string> = {
  MET_INFLUENCER: "Met Influencer",
  MET_DECISION_MAKER: "Met Decision Maker",
  DEMO_DONE: "Demo Done",
  PRICING_REQUESTED: "Pricing Requested",
  BUDGET_DISCUSSED: "Budget Discussed",
  BUDGET_CONFIRMED: "Budget Confirmed",
  PROPOSAL_SHARED: "Proposal Shared",
  NEGOTIATION_STARTED: "Negotiation Started",
  DEAL_CONFIRMED: "Deal Confirmed",
  PO_RECEIVED: "PO Received",
  NO_RESPONSE: "No Response",
  FOLLOW_UP_DONE: "Follow Up Done",
  INTERNAL_DISCUSSION: "Internal Discussion",
  DECISION_DELAYED: "Decision Delayed",
  DECISION_MAKER_UNAVAILABLE: "Decision Maker Unavailable",
  BUDGET_NOT_AVAILABLE: "Budget Not Available",
  DEAL_ON_HOLD: "Deal On Hold",
  LOST_TO_COMPETITOR: "Lost To Competitor",
  DEAL_DROPPED: "Deal Dropped",
};

export const OUTCOME_GROUPS: Array<{
  label: "Positive Movement" | "No Movement" | "Negative";
  values: OutcomeValue[];
}> = [
  {
    label: "Positive Movement",
    values: [
      "MET_INFLUENCER",
      "MET_DECISION_MAKER",
      "DEMO_DONE",
      "PRICING_REQUESTED",
      "BUDGET_DISCUSSED",
      "BUDGET_CONFIRMED",
      "PROPOSAL_SHARED",
      "NEGOTIATION_STARTED",
      "DEAL_CONFIRMED",
      "PO_RECEIVED",
    ],
  },
  {
    label: "No Movement",
    values: [
      "NO_RESPONSE",
      "FOLLOW_UP_DONE",
      "INTERNAL_DISCUSSION",
      "DECISION_DELAYED",
      "DECISION_MAKER_UNAVAILABLE",
    ],
  },
  {
    label: "Negative",
    values: [
      "BUDGET_NOT_AVAILABLE",
      "DEAL_ON_HOLD",
      "LOST_TO_COMPETITOR",
      "DEAL_DROPPED",
    ],
  },
];
export const RISK_CATEGORIES = [
  "NO_ACCESS_TO_DM",
  "STUCK_WITH_INFLUENCER",
  "BUDGET_NOT_DISCUSSED",
  "BUDGET_NOT_CONFIRMED",
  "BUDGET_INSUFFICIENT",
  "COMPETITOR_INVOLVED",
  "COMPETITOR_PREFERRED",
  "DECISION_DELAYED",
  "LOW_PRODUCT_FIT",
  "FEATURE_GAP",
  "CHAMPION_NOT_STRONG",
  "INTERNAL_ALIGNMENT_MISSING",
] as const;
export type RiskCategoryValue = (typeof RISK_CATEGORIES)[number];

export const RISK_LABELS: Record<RiskCategoryValue, string> = {
  NO_ACCESS_TO_DM: "No Access to Decision Maker",
  STUCK_WITH_INFLUENCER: "Stuck with Influencer",
  CHAMPION_NOT_STRONG: "Champion Not Strong",
  BUDGET_NOT_DISCUSSED: "Budget Not Discussed",
  BUDGET_NOT_CONFIRMED: "Budget Not Confirmed",
  BUDGET_INSUFFICIENT: "Budget Insufficient",
  DECISION_DELAYED: "Decision Delayed",
  INTERNAL_ALIGNMENT_MISSING: "Internal Alignment Missing",
  COMPETITOR_INVOLVED: "Competitor Involved",
  COMPETITOR_PREFERRED: "Competitor Preferred",
  LOW_PRODUCT_FIT: "Low Product Fit",
  FEATURE_GAP: "Feature Gap",
};

export const RISK_GROUPS: Array<{
  label:
    | "Stakeholder / Access"
    | "Budget"
    | "Decision / Process"
    | "Competition"
    | "Product";
  values: RiskCategoryValue[];
}> = [
  {
    label: "Stakeholder / Access",
    values: ["NO_ACCESS_TO_DM", "STUCK_WITH_INFLUENCER", "CHAMPION_NOT_STRONG"],
  },
  {
    label: "Budget",
    values: ["BUDGET_NOT_DISCUSSED", "BUDGET_NOT_CONFIRMED", "BUDGET_INSUFFICIENT"],
  },
  {
    label: "Decision / Process",
    values: ["DECISION_DELAYED", "INTERNAL_ALIGNMENT_MISSING"],
  },
  {
    label: "Competition",
    values: ["COMPETITOR_INVOLVED", "COMPETITOR_PREFERRED"],
  },
  {
    label: "Product",
    values: ["LOW_PRODUCT_FIT", "FEATURE_GAP"],
  },
];

export type DealStage =
  | "ACCESS"
  | "QUALIFIED"
  | "EVALUATION"
  | "COMMITTED"
  | "CLOSED"
  | "LOST";
