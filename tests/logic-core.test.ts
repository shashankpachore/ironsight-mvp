import { describe, expect, it } from "vitest";
import { getSuggestedNextStep } from "../lib/next-step";
import { classifyDeal } from "../lib/today-logic";

const today = new Date("2026-01-10T00:00:00.000Z");

function daysFrom(base: Date, delta: number): Date {
  return new Date(base.getTime() + delta * 86_400_000);
}

describe("logic core - next step suggestion", () => {
  it("Demo Done -> SEND_PRICING", () => {
    expect(getSuggestedNextStep("DEMO_DONE").type).toBe("SEND_PRICING");
  });

  it("Pricing Requested -> SEND_PRICING", () => {
    expect(getSuggestedNextStep("PRICING_REQUESTED").type).toBe("SEND_PRICING");
  });

  it("Budget Discussed -> SEND_PROPOSAL", () => {
    expect(getSuggestedNextStep("BUDGET_DISCUSSED").type).toBe("SEND_PROPOSAL");
  });

  it("Proposal Shared -> FOLLOW_UP", () => {
    expect(getSuggestedNextStep("PROPOSAL_SHARED").type).toBe("FOLLOW_UP");
  });

  it("Negotiation Started -> FOLLOW_UP", () => {
    expect(getSuggestedNextStep("NEGOTIATION_STARTED").type).toBe("FOLLOW_UP");
  });

  it("No Response -> FOLLOW_UP", () => {
    expect(getSuggestedNextStep("NO_RESPONSE").type).toBe("FOLLOW_UP");
  });

  it("Not Interested -> CLOSE_DEAL", () => {
    expect(getSuggestedNextStep("Not Interested").type).toBe("CLOSE_DEAL");
  });
});

describe("logic core - today classification", () => {
  it("CRITICAL when next step is 5 days overdue", () => {
    expect(
      classifyDeal({
        nextStepDate: daysFrom(today, -5),
        lastActivityAt: daysFrom(today, -1),
        today,
      }),
    ).toBe("CRITICAL");
  });

  it("CRITICAL when last activity is 12 days old", () => {
    expect(
      classifyDeal({
        nextStepDate: daysFrom(today, 5),
        lastActivityAt: daysFrom(today, -12),
        today,
      }),
    ).toBe("CRITICAL");
  });

  it("ATTENTION when last activity is 8 days old", () => {
    expect(
      classifyDeal({
        nextStepDate: daysFrom(today, 5),
        lastActivityAt: daysFrom(today, -8),
        today,
      }),
    ).toBe("ATTENTION");
  });

  it("UPCOMING when next step is today", () => {
    expect(
      classifyDeal({
        nextStepDate: today,
        lastActivityAt: daysFrom(today, -1),
        today,
      }),
    ).toBe("UPCOMING");
  });

  it("UPCOMING when next step is tomorrow", () => {
    expect(
      classifyDeal({
        nextStepDate: daysFrom(today, 1),
        lastActivityAt: daysFrom(today, -2),
        today,
      }),
    ).toBe("UPCOMING");
  });

  it("IGNORE for recent activity and future next step", () => {
    expect(
      classifyDeal({
        nextStepDate: daysFrom(today, 7),
        lastActivityAt: daysFrom(today, -3),
        today,
      }),
    ).toBe("IGNORE");
  });
});
