import { Outcome } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getDealStageFromOutcomes } from "../lib/deals";

describe("getDealStageFromOutcomes - stage derivation", () => {
  it("returns ACCESS for early positive-only signal", () => {
    expect(getDealStageFromOutcomes([Outcome.MET_INFLUENCER])).toBe("ACCESS");
  });

  it("returns QUALIFIED for decision-maker plus budget discussed", () => {
    expect(
      getDealStageFromOutcomes([Outcome.MET_DECISION_MAKER, Outcome.BUDGET_DISCUSSED]),
    ).toBe("QUALIFIED");
  });

  it("returns EVALUATION for each evaluation signal", () => {
    const evaluationOutcomes: Outcome[] = [
      Outcome.DEMO_DONE,
      Outcome.PRICING_REQUESTED,
      Outcome.PROPOSAL_SHARED,
      Outcome.BUDGET_CONFIRMED,
      Outcome.NEGOTIATION_STARTED,
    ];

    for (const outcome of evaluationOutcomes) {
      expect(getDealStageFromOutcomes([outcome])).toBe("EVALUATION");
    }
  });

  it("returns COMMITTED when all committed signals are present", () => {
    expect(
      getDealStageFromOutcomes([
        Outcome.MET_DECISION_MAKER,
        Outcome.BUDGET_DISCUSSED,
        Outcome.PROPOSAL_SHARED,
        Outcome.DEAL_CONFIRMED,
      ]),
    ).toBe("COMMITTED");
  });
});

describe("getDealStageFromOutcomes - terminal priority", () => {
  it("returns LOST for LOST_TO_COMPETITOR even with positive outcomes", () => {
    expect(
      getDealStageFromOutcomes([
        Outcome.MET_DECISION_MAKER,
        Outcome.BUDGET_DISCUSSED,
        Outcome.LOST_TO_COMPETITOR,
      ]),
    ).toBe("LOST");
  });

  it("returns LOST for DEAL_DROPPED", () => {
    expect(getDealStageFromOutcomes([Outcome.DEAL_DROPPED])).toBe("LOST");
  });

  it("returns CLOSED for DEAL_CONFIRMED plus PO_RECEIVED", () => {
    expect(getDealStageFromOutcomes([Outcome.DEAL_CONFIRMED, Outcome.PO_RECEIVED])).toBe("CLOSED");
  });

  it("returns CLOSED when both lost and PO pair are present", () => {
    expect(
      getDealStageFromOutcomes([
        Outcome.LOST_TO_COMPETITOR,
        Outcome.DEAL_CONFIRMED,
        Outcome.PO_RECEIVED,
      ]),
    ).toBe("CLOSED");
  });
});

describe("getDealStageFromOutcomes - edge cases", () => {
  it("returns LOST for mixed positive and negative outcomes", () => {
    expect(
      getDealStageFromOutcomes([
        Outcome.MET_DECISION_MAKER,
        Outcome.BUDGET_DISCUSSED,
        Outcome.LOST_TO_COMPETITOR,
      ]),
    ).toBe("LOST");
  });

  it("returns ACCESS for empty outcomes", () => {
    expect(getDealStageFromOutcomes([])).toBe("ACCESS");
  });
});
