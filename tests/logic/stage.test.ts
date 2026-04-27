import { describe, expect, it } from "vitest";
import { getDealStageFromOutcomes, stageBeforeLoss } from "../../lib/logic/stage";
import type { OutcomeValue } from "../../lib/domain";

describe("getDealStageFromOutcomes (pure)", () => {
  it("derives ACCESS from early outcomes", () => {
    expect(getDealStageFromOutcomes(["MET_INFLUENCER"])).toBe("ACCESS");
  });

  it("derives QUALIFIED from DM + budget", () => {
    expect(getDealStageFromOutcomes(["MET_DECISION_MAKER", "BUDGET_DISCUSSED"])).toBe(
      "QUALIFIED",
    );
  });

  it("derives EVALUATION from evaluation outcomes", () => {
    const evalOutcomes: OutcomeValue[] = [
      "DEMO_DONE",
      "PRICING_REQUESTED",
      "PROPOSAL_SHARED",
      "BUDGET_CONFIRMED",
      "NEGOTIATION_STARTED",
    ];
    for (const outcome of evalOutcomes) {
      expect(getDealStageFromOutcomes([outcome])).toBe("EVALUATION");
    }
  });

  it("derives COMMITTED with required signals", () => {
    expect(
      getDealStageFromOutcomes([
        "MET_DECISION_MAKER",
        "BUDGET_DISCUSSED",
        "PROPOSAL_SHARED",
        "DEAL_CONFIRMED",
      ]),
    ).toBe("COMMITTED");
  });

  it("handles terminal priority with CLOSED over LOST", () => {
    expect(getDealStageFromOutcomes(["LOST_TO_COMPETITOR"])).toBe("LOST");
    expect(getDealStageFromOutcomes(["DEAL_DROPPED"])).toBe("LOST");
    expect(getDealStageFromOutcomes(["DEAL_CONFIRMED", "PO_RECEIVED"])).toBe("CLOSED");
    expect(
      getDealStageFromOutcomes(["LOST_TO_COMPETITOR", "DEAL_CONFIRMED", "PO_RECEIVED"]),
    ).toBe("CLOSED");
  });

  it("returns ACCESS for empty outcomes", () => {
    expect(getDealStageFromOutcomes([])).toBe("ACCESS");
  });
});

describe("stageBeforeLoss (pure)", () => {
  it("returns ACCESS for ACCESS -> LOST", () => {
    expect(stageBeforeLoss(["LOST_TO_COMPETITOR"])).toBe("ACCESS");
  });

  it("returns QUALIFIED for QUALIFIED -> LOST", () => {
    expect(stageBeforeLoss(["MET_DECISION_MAKER", "BUDGET_DISCUSSED", "LOST_TO_COMPETITOR"])).toBe(
      "QUALIFIED",
    );
  });

  it("returns EVALUATION for EVALUATION -> LOST", () => {
    expect(
      stageBeforeLoss([
        "MET_DECISION_MAKER",
        "BUDGET_DISCUSSED",
        "PROPOSAL_SHARED",
        "DEAL_DROPPED",
      ]),
    ).toBe("EVALUATION");
  });

  it("ignores outcomes after first loss", () => {
    expect(
      stageBeforeLoss([
        "MET_DECISION_MAKER",
        "BUDGET_DISCUSSED",
        "LOST_TO_COMPETITOR",
        "PROPOSAL_SHARED",
        "DEAL_CONFIRMED",
      ]),
    ).toBe("QUALIFIED");
  });

  it("uses first loss when multiple loss events exist", () => {
    expect(
      stageBeforeLoss([
        "MET_DECISION_MAKER",
        "LOST_TO_COMPETITOR",
        "BUDGET_DISCUSSED",
        "DEAL_DROPPED",
      ]),
    ).toBe("ACCESS");
  });

  it("falls back to full stage when no loss exists", () => {
    expect(stageBeforeLoss(["MET_DECISION_MAKER", "BUDGET_DISCUSSED"])).toBe("QUALIFIED");
  });
});
