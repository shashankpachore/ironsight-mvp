import {
  InteractionType,
  Outcome,
  RiskCategory,
  StakeholderType,
} from "@prisma/client";
import { isValidNextStepType } from "./next-step";
import { isValidProduct } from "./products";

function isEnumValue<T extends Record<string, string>>(
  enumObj: T,
  value: unknown,
): value is T[keyof T] {
  return typeof value === "string" && Object.values(enumObj).includes(value);
}

export function validateDealInput(input: unknown) {
  const body = input as Record<string, unknown>;

  if (!body?.name || typeof body.name !== "string") return "name is required";
  if (!isValidProduct(body.name)) return "invalid product";
  if (!body?.accountId || typeof body.accountId !== "string") {
    return "accountId is required";
  }
  if (typeof body.value !== "number" || body.value <= 0) {
    return "value must be > 0";
  }
  return null;
}

export function validateLogInput(input: unknown) {
  const body = input as Record<string, unknown>;

  if (!body?.dealId || typeof body.dealId !== "string") return "dealId is required";
  if (!isEnumValue(InteractionType, body.interactionType)) {
    return "interactionType required";
  }
  if (!isEnumValue(Outcome, body.outcome)) return "outcome required";
  if (!isEnumValue(StakeholderType, body.stakeholderType)) {
    return "stakeholderType required";
  }
  if (!Array.isArray(body.risks) || body.risks.length < 1) {
    return "at least 1 risk required";
  }
  if (body.risks.length > 3) return "max 3 risks";
  if (!body.risks.every((risk) => isEnumValue(RiskCategory, risk))) {
    return "invalid risk category";
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    return "notes must be a string";
  }
  if (!isValidNextStepType(body.nextStepType)) {
    return "nextStepType required";
  }
  if (typeof body.nextStepDate !== "string" || !body.nextStepDate.trim()) {
    return "nextStepDate required";
  }
  const nextDate = new Date(body.nextStepDate);
  if (Number.isNaN(nextDate.getTime())) {
    return "invalid nextStepDate";
  }
  if (body.nextStepNote !== undefined && typeof body.nextStepNote !== "string") {
    return "nextStepNote must be a string";
  }
  if (
    body.nextStepSource !== undefined &&
    body.nextStepSource !== "AUTO" &&
    body.nextStepSource !== "MANUAL"
  ) {
    return "nextStepSource must be AUTO or MANUAL";
  }
  return null;
}

export function validateOutcomeGuardrails(params: {
  outcome: Outcome;
  dealValue: number;
  existingOutcomes: Outcome[];
}) {
  const outcomes = new Set(params.existingOutcomes);

  if (params.outcome === Outcome.PROPOSAL_SHARED && params.dealValue <= 0) {
    return "proposal requires deal value > 0";
  }

  if (params.outcome === Outcome.DEAL_CONFIRMED) {
    if (!outcomes.has(Outcome.MET_DECISION_MAKER)) {
      return "deal confirmation requires MET_DECISION_MAKER";
    }
    if (!outcomes.has(Outcome.BUDGET_DISCUSSED)) {
      return "deal confirmation requires BUDGET_DISCUSSED";
    }
    if (!outcomes.has(Outcome.PROPOSAL_SHARED)) {
      return "deal confirmation requires PROPOSAL_SHARED";
    }
  }

  if (params.outcome === Outcome.PO_RECEIVED && !outcomes.has(Outcome.DEAL_CONFIRMED)) {
    return "PO_RECEIVED requires DEAL_CONFIRMED";
  }

  return null;
}
