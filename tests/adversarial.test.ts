import { beforeEach, describe, expect, it } from "vitest";
import { AccountStatus, Outcome, InteractionType, StakeholderType, RiskCategory } from "@prisma/client";
import { getDealStage, getMissingSignals } from "../lib/deals";
import {
  validateDealInput,
  validateLogInput,
  validateOutcomeGuardrails,
} from "../lib/validation";
import { prismaTest as prisma } from "../lib/test-prisma";

let ownerId: string;
let accountId: string;

type Scenario = {
  key: string;
  outcomes: Outcome[];
  lastActivityAtDaysAgo?: number;
  logsDaysAgo?: number;
  expectedStage: "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED" | "CLOSED" | "LOST";
  expectedMissingSignals?: string[];
};

const scenarios: Scenario[] = [
  {
    key: "clean-ideal-deal",
    outcomes: [
      Outcome.MET_DECISION_MAKER,
      Outcome.BUDGET_DISCUSSED,
      Outcome.PROPOSAL_SHARED,
      Outcome.DEAL_CONFIRMED,
    ],
    expectedStage: "COMMITTED",
    expectedMissingSignals: [],
  },
  {
    key: "no-decision-maker",
    outcomes: [Outcome.BUDGET_DISCUSSED, Outcome.PROPOSAL_SHARED],
    expectedStage: "EVALUATION",
    expectedMissingSignals: ["Missing Decision Maker"],
  },
  {
    key: "no-budget",
    outcomes: [Outcome.MET_DECISION_MAKER, Outcome.PROPOSAL_SHARED],
    expectedStage: "EVALUATION",
    expectedMissingSignals: ["Missing Budget Discussion"],
  },
  {
    key: "only-influencer-interactions",
    outcomes: [Outcome.MET_INFLUENCER, Outcome.FOLLOW_UP_DONE],
    expectedStage: "ACCESS",
    expectedMissingSignals: [
      "Missing Decision Maker",
      "Missing Budget Discussion",
      "Missing Proposal",
    ],
  },
  {
    key: "only-no-movement-logs",
    outcomes: [Outcome.NO_RESPONSE, Outcome.NO_RESPONSE, Outcome.NO_RESPONSE],
    expectedStage: "ACCESS",
    expectedMissingSignals: [
      "Missing Decision Maker",
      "Missing Budget Discussion",
      "Missing Proposal",
    ],
  },
  {
    key: "fake-high-progress-incorrect-signals",
    outcomes: [Outcome.PROPOSAL_SHARED],
    expectedStage: "EVALUATION",
    expectedMissingSignals: ["Missing Decision Maker", "Missing Budget Discussion"],
  },
  {
    key: "stale-deal-no-activity",
    outcomes: [Outcome.MET_INFLUENCER],
    lastActivityAtDaysAgo: 8,
    logsDaysAgo: 8,
    expectedStage: "ACCESS",
    expectedMissingSignals: [
      "Missing Decision Maker",
      "Missing Budget Discussion",
      "Missing Proposal",
      "No Recent Activity (7 days)",
    ],
  },
  {
    key: "over-logged-deal",
    outcomes: [
      Outcome.NO_RESPONSE,
      Outcome.FOLLOW_UP_DONE,
      Outcome.MET_INFLUENCER,
      Outcome.NO_RESPONSE,
      Outcome.INTERNAL_DISCUSSION,
      Outcome.FOLLOW_UP_DONE,
      Outcome.NO_RESPONSE,
      Outcome.MET_INFLUENCER,
      Outcome.NO_RESPONSE,
      Outcome.DECISION_DELAYED,
      Outcome.NO_RESPONSE,
    ],
    expectedStage: "ACCESS",
    expectedMissingSignals: [
      "Missing Decision Maker",
      "Missing Budget Discussion",
      "Missing Proposal",
    ],
  },
  {
    key: "conflicting-signals",
    outcomes: [
      Outcome.DEAL_DROPPED,
      Outcome.PROPOSAL_SHARED,
      Outcome.NEGOTIATION_STARTED,
      Outcome.BUDGET_NOT_AVAILABLE,
    ],
    expectedStage: "LOST",
    expectedMissingSignals: ["Missing Decision Maker", "Missing Budget Discussion"],
  },
  {
    key: "immediate-close-deal",
    outcomes: [Outcome.PO_RECEIVED],
    expectedStage: "ACCESS",
    expectedMissingSignals: [
      "Missing Decision Maker",
      "Missing Budget Discussion",
      "Missing Proposal",
    ],
  },
];

async function resetAdversarialDb() {
  await prisma.interactionRisk.deleteMany();
  await prisma.interactionLogParticipant.deleteMany();
  await prisma.interactionLog.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.account.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.updateMany({ data: { managerId: null } });
  await prisma.user.deleteMany();

  const owner = await prisma.user.create({
    data: {
      name: "Adversarial Owner",
      email: `adversarial-${Date.now()}-${Math.random().toString(16).slice(2)}@ironsight.local`,
      password: "test1234",
      role: "REP",
    },
  });
  const account = await prisma.account.create({
    data: {
      name: `Adversarial Account ${Date.now()}`,
      normalized: `adversarial-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdById: owner.id,
      assignedToId: owner.id,
      status: AccountStatus.APPROVED,
    },
  });
  ownerId = owner.id;
  accountId = account.id;
}

async function createScenarioDeal(
  key: string,
  outcomes: Outcome[],
  lastActivityAtDaysAgo = 0,
  logsDaysAgo = 0,
) {
  const deal = await prisma.deal.create({
    data: {
      name: "Geneo ONE",
      companyName: `Scenario ${key}`,
      value: 10_000,
      accountId,
      ownerId,
      lastActivityAt: new Date(Date.now() - lastActivityAtDaysAgo * 24 * 60 * 60 * 1000),
    },
  });
  const createdAt = new Date(Date.now() - logsDaysAgo * 24 * 60 * 60 * 1000);
  await prisma.interactionLog.createMany({
    data: outcomes.map((outcome) => ({
      dealId: deal.id,
      interactionType: InteractionType.CALL,
      outcome,
      stakeholderType: StakeholderType.UNKNOWN,
      createdAt,
    })),
  });
  return deal.id;
}

beforeEach(async () => {
  await resetAdversarialDb();
});

describe("adversarial stage + missing signal matrix (10 scenarios)", () => {
  it.each(scenarios)("scenario: $key", async (scenario) => {
    const dealId = await createScenarioDeal(
      scenario.key,
      scenario.outcomes,
      scenario.lastActivityAtDaysAgo ?? 0,
      scenario.logsDaysAgo ?? 0,
    );

    const stage = await getDealStage(dealId);
    const missingSignals = await getMissingSignals(dealId);

    expect(stage).toBe(scenario.expectedStage);
    for (const expectedSignal of scenario.expectedMissingSignals ?? []) {
      expect(missingSignals).toContain(expectedSignal);
    }
  });
});

describe("critical adversarial checks", () => {
  it("A. FALSE PROGRESS: decision maker only should NOT jump to EVALUATION", async () => {
    const dealId = await createScenarioDeal("false-progress", [Outcome.MET_DECISION_MAKER]);
    const stage = await getDealStage(dealId);
    expect(stage).not.toBe("EVALUATION");
    expect(stage).toBe("ACCESS");
  });

  it("B. NO MOVEMENT SPAM: repeated NO_RESPONSE should not increase stage and should flag missing", async () => {
    const dealId = await createScenarioDeal(
      "no-movement-spam",
      [
        Outcome.NO_RESPONSE,
        Outcome.NO_RESPONSE,
        Outcome.NO_RESPONSE,
        Outcome.NO_RESPONSE,
      ],
      1,
    );

    const [stage, missingSignals] = await Promise.all([
      getDealStage(dealId),
      getMissingSignals(dealId),
    ]);

    expect(stage).toBe("ACCESS");
    expect(missingSignals).toContain("Missing Decision Maker");
    expect(missingSignals).toContain("Missing Budget Discussion");
  });

  it("C. MISSING CORE SIGNALS: should clearly flag missing DM + budget", async () => {
    const dealId = await createScenarioDeal("missing-core-signals", [Outcome.MET_INFLUENCER], 2);
    const missingSignals = await getMissingSignals(dealId);
    expect(missingSignals).toContain("Missing Decision Maker");
    expect(missingSignals).toContain("Missing Budget Discussion");
  });

  it("D. FAKE COMMITMENT guardrail: should reject direct DEAL_CONFIRMED without prior steps", async () => {
    const dealId = await createScenarioDeal("fake-commitment", [Outcome.DEAL_CONFIRMED]);
    const stage = await getDealStage(dealId);
    expect(stage).not.toBe("COMMITTED");
  });

  it("E. VALUE INTEGRITY: reject zero-value deal", () => {
    const error = validateDealInput({
      name: "Geneo ONE",
      accountId: "account-1",
      value: 0,
    });
    expect(error).toBe("value must be > 0");
  });

  it("E. PRODUCT VALIDATION: reject invalid product value", () => {
    const error = validateDealInput({
      name: "Random Product",
      accountId: "account-1",
      value: 10,
    });
    expect(error).toBe("invalid product");
  });

  it("E. VALUE INTEGRITY: proposal should reject when deal value <= 0", () => {
    const error = validateOutcomeGuardrails({
      outcome: Outcome.PROPOSAL_SHARED,
      dealValue: 0,
      existingOutcomes: [Outcome.MET_DECISION_MAKER],
    });
    expect(error).toBe("proposal requires deal value > 0");
  });

  it("F. STALE DEAL: 7+ day inactivity should be flagged", async () => {
    const dealId = await createScenarioDeal(
      "stale-deal",
      [Outcome.MET_DECISION_MAKER, Outcome.BUDGET_DISCUSSED],
      8,
      8,
    );
    const missingSignals = await getMissingSignals(dealId);
    expect(missingSignals).toContain("No Recent Activity (7 days)");
  });

  it("G. RISK VALIDATION: base validation no longer enforces minimum risk count", () => {
    const error = validateLogInput({
      dealId: "deal-2",
      interactionType: InteractionType.CALL,
      outcome: Outcome.FOLLOW_UP_DONE,
      stakeholderType: StakeholderType.UNKNOWN,
      risks: [],
    });
    expect(error).toBe("nextStepType required");
  });

  it("G. RISK VALIDATION: reject >3 risks", () => {
    const error = validateLogInput({
      dealId: "deal-3",
      interactionType: InteractionType.ONLINE_MEETING,
      outcome: Outcome.MET_INFLUENCER,
      stakeholderType: StakeholderType.INFLUENCER,
      risks: [
        RiskCategory.NO_ACCESS_TO_DM,
        RiskCategory.STUCK_WITH_INFLUENCER,
        RiskCategory.BUDGET_NOT_DISCUSSED,
        RiskCategory.COMPETITOR_INVOLVED,
      ],
    });
    expect(error).toBe("max 3 risks");
  });

  it("Outcome validation: DEAL_CONFIRMED requires DM + budget + proposal", () => {
    const error = validateOutcomeGuardrails({
      outcome: Outcome.DEAL_CONFIRMED,
      dealValue: 10000,
      existingOutcomes: [Outcome.MET_DECISION_MAKER, Outcome.BUDGET_DISCUSSED],
    });
    expect(error).toBe("deal confirmation requires PROPOSAL_SHARED");
  });

  it("Outcome validation: PO_RECEIVED requires DEAL_CONFIRMED", () => {
    const error = validateOutcomeGuardrails({
      outcome: Outcome.PO_RECEIVED,
      dealValue: 10000,
      existingOutcomes: [
        Outcome.MET_DECISION_MAKER,
        Outcome.BUDGET_DISCUSSED,
        Outcome.PROPOSAL_SHARED,
      ],
    });
    expect(error).toBe("PO_RECEIVED requires DEAL_CONFIRMED");
  });
});

describe("UX friction simulation (logging flow)", () => {
  it("still requires next-step fields for low-information non-PO updates", () => {
    const noResponsePayload = {
      dealId: "deal-ux",
      interactionType: InteractionType.CALL,
      outcome: Outcome.NO_RESPONSE,
      stakeholderType: StakeholderType.UNKNOWN,
      risks: [] as RiskCategory[],
    };

    const error = validateLogInput(noResponsePayload);
    expect(error).toBe("nextStepType required");
  });
});
