import { beforeEach, describe, expect, it } from "vitest";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { GET as lossReasonsGET } from "../app/api/insights/loss-reasons/route";
import {
  approveAccount,
  assignAccount,
  createAccount,
  createDeal,
  json,
  makeRequest,
  resetDbAndSeedUsers,
  uniqueName,
} from "./helpers";
import { defaultNextStepRequestFields } from "../lib/next-step";
import { POST as logsPOST } from "../app/api/logs/route";
import { PRODUCT_OPTIONS } from "../lib/products";

async function logWithRisk(params: {
  userId: string;
  dealId: string;
  outcome: Outcome;
  risk: RiskCategory;
}) {
  return logsPOST(
    makeRequest("http://localhost/api/logs", {
      method: "POST",
      userId: params.userId,
      body: {
        dealId: params.dealId,
        interactionType: InteractionType.CALL,
        outcome: params.outcome,
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [params.risk],
        ...defaultNextStepRequestFields(params.outcome),
      },
    }),
  );
}

describe("loss reasons insights", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let rep2DealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();

    const accountOne = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("LossA") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: accountOne.id });
    await assignAccount({ byUserId: users.admin.id, accountId: accountOne.id, assigneeId: users.rep.id });
    repDealId = (
      await json<{ id: string }>(
        await createDeal({
          byUserId: users.rep.id,
          accountId: accountOne.id,
          name: PRODUCT_OPTIONS[0],
          value: 100,
        }),
      )
    ).id;

    const accountTwo = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("LossB") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: accountTwo.id });
    await assignAccount({ byUserId: users.admin.id, accountId: accountTwo.id, assigneeId: users.rep2.id });
    rep2DealId = (
      await json<{ id: string }>(
        await createDeal({
          byUserId: users.rep2.id,
          accountId: accountTwo.id,
          name: PRODUCT_OPTIONS[1],
          value: 120,
        }),
      )
    ).id;

    expect(
      (await logWithRisk({
        userId: users.rep.id,
        dealId: repDealId,
        outcome: Outcome.MET_DECISION_MAKER,
        risk: RiskCategory.NO_ACCESS_TO_DM,
      })).status,
    ).toBe(201);
    expect(
      (await logWithRisk({
        userId: users.rep.id,
        dealId: repDealId,
        outcome: Outcome.BUDGET_DISCUSSED,
        risk: RiskCategory.BUDGET_NOT_CONFIRMED,
      })).status,
    ).toBe(201);
    expect(
      (await logWithRisk({
        userId: users.rep.id,
        dealId: repDealId,
        outcome: Outcome.LOST_TO_COMPETITOR,
        risk: RiskCategory.COMPETITOR_PREFERRED,
      })).status,
    ).toBe(201);

    expect(
      (await logWithRisk({
        userId: users.rep2.id,
        dealId: rep2DealId,
        outcome: Outcome.MET_DECISION_MAKER,
        risk: RiskCategory.NO_ACCESS_TO_DM,
      })).status,
    ).toBe(201);
    expect(
      (await logWithRisk({
        userId: users.rep2.id,
        dealId: rep2DealId,
        outcome: Outcome.DEAL_DROPPED,
        risk: RiskCategory.FEATURE_GAP,
      })).status,
    ).toBe(201);
  });

  it("manager scope includes only team LOST deals", async () => {
    const res = await lossReasonsGET(makeRequest("http://localhost/api/insights/loss-reasons", { userId: users.manager.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      summary: { totalLostDeals: number; totalLossRiskTags: number };
      topLossReasons: Array<{ riskCategory: string; count: number; percentContribution: number }>;
      riskFrequencyByStage: Array<{ stage: string; riskCategory: string; count: number }>;
    }>(res);

    expect(body.summary.totalLostDeals).toBe(1);
    expect(body.summary.totalLossRiskTags).toBe(3);
    expect(body.topLossReasons.map((r) => r.riskCategory)).toEqual([
      "BUDGET_NOT_CONFIRMED",
      "COMPETITOR_PREFERRED",
      "NO_ACCESS_TO_DM",
    ]);
    expect(body.topLossReasons.every((r) => r.percentContribution === 33.33)).toBe(true);
  });

  it("admin sees ranked reasons across all LOST deals", async () => {
    const res = await lossReasonsGET(makeRequest("http://localhost/api/insights/loss-reasons", { userId: users.admin.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      summary: { totalLostDeals: number; totalLossRiskTags: number };
      topLossReasons: Array<{ riskCategory: string; count: number; percentContribution: number }>;
      riskFrequencyByStage: Array<{ stage: string; riskCategory: string; count: number }>;
    }>(res);

    expect(body.summary.totalLostDeals).toBe(2);
    expect(body.summary.totalLossRiskTags).toBe(5);
    expect(body.topLossReasons[0]).toEqual({
      riskCategory: "NO_ACCESS_TO_DM",
      count: 2,
      percentContribution: 40,
    });
  });

  it("computes stage-before-loss risk frequency", async () => {
    const res = await lossReasonsGET(makeRequest("http://localhost/api/insights/loss-reasons", { userId: users.admin.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      riskFrequencyByStage: Array<{ stage: string; riskCategory: string; count: number }>;
    }>(res);

    const stageMap = new Map(body.riskFrequencyByStage.map((row) => [`${row.stage}::${row.riskCategory}`, row.count]));
    expect(stageMap.get("ACCESS::NO_ACCESS_TO_DM")).toBe(2);
    expect(stageMap.get("QUALIFIED::BUDGET_NOT_CONFIRMED")).toBe(1);
    expect(stageMap.get("QUALIFIED::COMPETITOR_PREFERRED")).toBe(1);
    expect(stageMap.get("ACCESS::FEATURE_GAP")).toBe(1);
  });
});

describe("loss reasons insights - stage before first loss inference", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  async function createLostDealWithLogs(params: {
    accountNamePrefix: string;
    dealName: string;
    preLossLogs: Array<{ outcome: Outcome; risk: RiskCategory }>;
    firstLoss: { outcome: Outcome; risk: RiskCategory };
    postLossLogs?: Array<{ outcome: Outcome; risk: RiskCategory }>;
  }) {
    const account = await json<{ id: string }>(
      await createAccount({
        byUserId: users.admin.id,
        name: uniqueName(params.accountNamePrefix),
      }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({
      byUserId: users.admin.id,
      accountId: account.id,
      assigneeId: users.rep.id,
    });
    const dealId = (
      await json<{ id: string }>(
        await createDeal({
          byUserId: users.rep.id,
          accountId: account.id,
          name: params.dealName,
          value: 100,
        }),
      )
    ).id;

    for (const log of params.preLossLogs) {
      expect(
        (
          await logWithRisk({
            userId: users.rep.id,
            dealId,
            outcome: log.outcome,
            risk: log.risk,
          })
        ).status,
      ).toBe(201);
    }

    expect(
      (
        await logWithRisk({
          userId: users.rep.id,
          dealId,
          outcome: params.firstLoss.outcome,
          risk: params.firstLoss.risk,
        })
      ).status,
    ).toBe(201);

    for (const log of params.postLossLogs ?? []) {
      expect(
        (
          await logWithRisk({
            userId: users.rep.id,
            dealId,
            outcome: log.outcome,
            risk: log.risk,
          })
        ).status,
      ).toBe(201);
    }
  }

  async function getStageMap() {
    const res = await lossReasonsGET(
      makeRequest("http://localhost/api/insights/loss-reasons", { userId: users.admin.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      riskFrequencyByStage: Array<{ stage: string; riskCategory: string; count: number }>;
    }>(res);
    return new Map(body.riskFrequencyByStage.map((row) => [`${row.stage}::${row.riskCategory}`, row.count]));
  }

  it("captures ACCESS as stage before first loss", async () => {
    await createLostDealWithLogs({
      accountNamePrefix: "LossAccess",
      dealName: PRODUCT_OPTIONS[0],
      preLossLogs: [],
      firstLoss: {
        outcome: Outcome.LOST_TO_COMPETITOR,
        risk: RiskCategory.COMPETITOR_PREFERRED,
      },
    });

    const stageMap = await getStageMap();
    expect(stageMap.get("ACCESS::COMPETITOR_PREFERRED")).toBe(1);
  });

  it("captures QUALIFIED as stage before first loss", async () => {
    await createLostDealWithLogs({
      accountNamePrefix: "LossQualified",
      dealName: PRODUCT_OPTIONS[0],
      preLossLogs: [
        { outcome: Outcome.MET_DECISION_MAKER, risk: RiskCategory.NO_ACCESS_TO_DM },
        { outcome: Outcome.BUDGET_DISCUSSED, risk: RiskCategory.BUDGET_NOT_CONFIRMED },
      ],
      firstLoss: {
        outcome: Outcome.LOST_TO_COMPETITOR,
        risk: RiskCategory.COMPETITOR_PREFERRED,
      },
    });

    const stageMap = await getStageMap();
    expect(stageMap.get("QUALIFIED::COMPETITOR_PREFERRED")).toBe(1);
  });

  it("captures EVALUATION as stage before first loss", async () => {
    await createLostDealWithLogs({
      accountNamePrefix: "LossEvaluation",
      dealName: PRODUCT_OPTIONS[0],
      preLossLogs: [
        { outcome: Outcome.MET_DECISION_MAKER, risk: RiskCategory.NO_ACCESS_TO_DM },
        { outcome: Outcome.BUDGET_DISCUSSED, risk: RiskCategory.BUDGET_NOT_CONFIRMED },
        { outcome: Outcome.PROPOSAL_SHARED, risk: RiskCategory.FEATURE_GAP },
      ],
      firstLoss: {
        outcome: Outcome.LOST_TO_COMPETITOR,
        risk: RiskCategory.COMPETITOR_PREFERRED,
      },
    });

    const stageMap = await getStageMap();
    expect(stageMap.get("EVALUATION::COMPETITOR_PREFERRED")).toBe(1);
  });

  it("ignores logs after first loss for stage-before-loss attribution", async () => {
    await createLostDealWithLogs({
      accountNamePrefix: "LossIgnoreAfter",
      dealName: PRODUCT_OPTIONS[0],
      preLossLogs: [],
      firstLoss: {
        outcome: Outcome.LOST_TO_COMPETITOR,
        risk: RiskCategory.COMPETITOR_PREFERRED,
      },
      postLossLogs: [
        { outcome: Outcome.FOLLOW_UP_DONE, risk: RiskCategory.FEATURE_GAP },
        { outcome: Outcome.NO_RESPONSE, risk: RiskCategory.LOW_PRODUCT_FIT },
      ],
    });

    const stageMap = await getStageMap();
    expect(stageMap.get("ACCESS::COMPETITOR_PREFERRED")).toBe(1);
    expect(stageMap.get("LOST::FEATURE_GAP")).toBeUndefined();
    expect(stageMap.get("LOST::LOW_PRODUCT_FIT")).toBeUndefined();
  });

  it("uses only first loss event when multiple loss events exist", async () => {
    await createLostDealWithLogs({
      accountNamePrefix: "LossFirstOnly",
      dealName: PRODUCT_OPTIONS[0],
      preLossLogs: [{ outcome: Outcome.MET_DECISION_MAKER, risk: RiskCategory.NO_ACCESS_TO_DM }],
      firstLoss: {
        outcome: Outcome.LOST_TO_COMPETITOR,
        risk: RiskCategory.COMPETITOR_PREFERRED,
      },
      postLossLogs: [{ outcome: Outcome.DEAL_DROPPED, risk: RiskCategory.FEATURE_GAP }],
    });

    const stageMap = await getStageMap();
    expect(stageMap.get("ACCESS::COMPETITOR_PREFERRED")).toBe(1);
    expect(stageMap.get("LOST::FEATURE_GAP")).toBeUndefined();
  });
});
