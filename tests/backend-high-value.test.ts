import { beforeEach, describe, expect, it } from "vitest";
import { DealStatus, InteractionType, Outcome, StakeholderType, UserRole } from "@prisma/client";
import { GET as accountsDashboardGET } from "../app/api/accounts/dashboard/route";
import { GET as dealGET } from "../app/api/deals/[id]/route";
import { GET as dealsGET } from "../app/api/deals/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { GET as managerTodayFullGET } from "../app/api/today/manager-full/route";
import { getDealStageFromOutcomes } from "../lib/deals";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";
import {
  approveAccount,
  assignAccount,
  createAccount,
  createDeal,
  json,
  logInteraction,
  makeRequest,
  resetDbAndSeedUsers,
} from "./helpers";

const DAY_MS = 86_400_000;

type Users = Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

let users: Users;
let sequence = 0;

function nextName(label: string) {
  sequence += 1;
  return `Backend ${label} ${sequence}`;
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

async function createAssignedDeal(params: {
  ownerId: string;
  product?: string;
  value?: number;
}) {
  const account = await json<{ id: string }>(
    await createAccount({ byUserId: users.admin.id, name: nextName("Account") }),
  );
  await approveAccount({ byUserId: users.admin.id, accountId: account.id });
  await assignAccount({
    byUserId: users.admin.id,
    accountId: account.id,
    assigneeId: params.ownerId,
  });
  const deal = await json<{ id: string }>(
    await createDeal({
      byUserId: params.ownerId,
      accountId: account.id,
      name: params.product ?? PRODUCT_OPTIONS[0],
      value: params.value ?? 10_000,
    }),
  );
  return { id: deal.id, accountId: account.id };
}

async function getDealBody(dealId: string, userId = users.rep.id) {
  const res = await dealGET(
    makeRequest(`http://localhost/api/deals/${dealId}`, { userId }),
    { params: Promise.resolve({ id: dealId }) },
  );
  expect(res.status).toBe(200);
  return json<{ id: string; stage: string; status: DealStatus }>(res);
}

beforeEach(async () => {
  sequence = 0;
  users = await resetDbAndSeedUsers();
});

describe("backend high-value API flows", () => {
  it("GET /api/today/manager-full returns today and insights, including empty datasets", async () => {
    const emptyRes = await managerTodayFullGET(
      makeRequest("http://localhost/api/today/manager-full", { userId: users.manager.id }),
    );
    expect(emptyRes.status).toBe(200);
    const empty = await json<{
      today: { mode: "MANAGER"; drilldown: { critical: unknown[]; attention: unknown[]; upcoming: unknown[] } };
      insights: { atRiskDeals: unknown[]; repHealth: unknown[] };
    }>(emptyRes);
    expect(empty.today.mode).toBe("MANAGER");
    expect(empty.today.drilldown).toMatchObject({ critical: [], attention: [], upcoming: [] });
    expect(empty.insights.atRiskDeals).toEqual([]);
    expect(empty.insights.repHealth.length).toBeGreaterThan(0);

    const deal = await createAssignedDeal({ ownerId: users.rep.id, value: 25_000 });
    await prisma.deal.update({
      where: { id: deal.id },
      data: { lastActivityAt: daysAgo(12), nextStepDate: daysFromNow(1), nextStepType: "FOLLOW_UP" },
    });

    const res = await managerTodayFullGET(
      makeRequest("http://localhost/api/today/manager-full", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      today: { reps: Array<{ repId: string; criticalCount: number }> };
      insights: { atRiskDeals: Array<{ dealId: string }>; expiredDealsSummary: unknown };
    }>(res);
    expect(body.today.reps.some((rep) => rep.repId === users.rep.id)).toBe(true);
    expect(body.today.reps.find((rep) => rep.repId === users.rep.id)?.criticalCount).toBe(1);
    expect(body.insights.atRiskDeals).toEqual([expect.objectContaining({ dealId: deal.id })]);
    expect(body.insights).toHaveProperty("expiredDealsSummary");
  });

  it("GET /api/today/manager-full keeps mixed active, expired, and no-log datasets separated", async () => {
    const activeDeal = await createAssignedDeal({ ownerId: users.manager.id, value: 10_000 });
    const expiredDeal = await createAssignedDeal({ ownerId: users.manager.id, value: 20_000 });
    const noLogDeal = await createAssignedDeal({ ownerId: users.manager.id, value: 30_000 });

    await logInteraction({
      byUserId: users.manager.id,
      dealId: activeDeal.id,
      outcome: Outcome.FOLLOW_UP_DONE,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await prisma.deal.update({
      where: { id: activeDeal.id },
      data: { nextStepDate: daysFromNow(1), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: expiredDeal.id },
      data: { lastActivityAt: daysAgo(46), status: DealStatus.ACTIVE },
    });
    await prisma.deal.update({
      where: { id: noLogDeal.id },
      data: { nextStepDate: daysFromNow(1), nextStepType: "FOLLOW_UP" },
    });

    const res = await managerTodayFullGET(
      makeRequest("http://localhost/api/today/manager-full", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      today: {
        drilldown: {
          critical: Array<{ dealId: string }>;
          attention: Array<{ dealId: string }>;
          upcoming: Array<{ dealId: string }>;
        };
      };
      insights: {
        atRiskDeals: Array<{ dealId: string }>;
        expiredDealsSummary: {
          totalExpiredDeals: number;
          totalExpiredValue: number;
          byRep: Array<{ ownerId: string; expiredDeals: number; expiredValue: number }>;
        };
      };
    }>(res);

    const criticalIds = body.today.drilldown.critical.map((deal) => deal.dealId).sort();
    const attentionIds = body.today.drilldown.attention.map((deal) => deal.dealId).sort();
    const upcomingIds = body.today.drilldown.upcoming.map((deal) => deal.dealId).sort();
    const activeVisibleIds = [...criticalIds, ...attentionIds, ...upcomingIds].sort();
    const activeVisibleIdSet = new Set(activeVisibleIds);

    expect(criticalIds).toEqual([]);
    expect(attentionIds).toEqual([]);
    expect(upcomingIds).toEqual([activeDeal.id, noLogDeal.id].sort());
    expect(activeVisibleIds).toHaveLength(2);
    expect(activeVisibleIdSet.size).toBe(2);

    expect(body.insights.atRiskDeals).toEqual([]);
    expect(body.insights.expiredDealsSummary).toEqual({
      totalExpiredDeals: 1,
      totalExpiredValue: 20_000,
      byRep: [
        {
          ownerId: users.manager.id,
          ownerName: "Manager",
          expiredDeals: 1,
          expiredValue: 20_000,
        },
      ],
    });
    expect(activeVisibleIdSet.has(expiredDeal.id)).toBe(false);
    expect(activeVisibleIds.length + body.insights.expiredDealsSummary.totalExpiredDeals).toBe(3);

    await expect(getDealBody(activeDeal.id, users.manager.id)).resolves.toMatchObject({
      stage: "ACCESS",
      status: DealStatus.ACTIVE,
    });
    await expect(getDealBody(noLogDeal.id, users.manager.id)).resolves.toMatchObject({
      stage: "ACCESS",
      status: DealStatus.ACTIVE,
    });
    await expect(getDealBody(expiredDeal.id, users.manager.id)).resolves.toMatchObject({
      status: DealStatus.EXPIRED,
    });
  });

  it("prevents data leakage across roles in batched pipeline and manager today endpoints", async () => {
    const repA2 = await prisma.user.create({
      data: {
        name: "Rep A2",
        email: "rep-a2@ironsight.local",
        password: "test1234",
        role: UserRole.REP,
        managerId: users.manager.id,
      },
    });
    const deal1 = await createAssignedDeal({ ownerId: users.rep.id, value: 11_000 });
    const deal2 = await createAssignedDeal({ ownerId: repA2.id, value: 22_000 });
    const deal3 = await createAssignedDeal({ ownerId: users.rep2.id, value: 33_000 });
    await prisma.deal.updateMany({
      where: { id: { in: [deal1.id, deal2.id, deal3.id] } },
      data: { lastActivityAt: daysAgo(12), nextStepDate: daysFromNow(1), nextStepType: "FOLLOW_UP" },
    });

    const repPipelineRes = await pipelineGET(
      makeRequest("http://localhost/api/pipeline?includeOutcomes=1", { userId: users.rep.id }),
    );
    expect(repPipelineRes.status).toBe(200);
    const repPipeline = await json<{
      pipeline: Record<string, { count: number; value: number }>;
      outcomes: Record<string, { count: number; value: number }>;
      managerBreakdown?: unknown;
      personalPipeline?: unknown;
    }>(repPipelineRes);
    expect(repPipeline.pipeline).toEqual({
      ACCESS: { count: 1, value: 11_000 },
      QUALIFIED: { count: 0, value: 0 },
      EVALUATION: { count: 0, value: 0 },
      COMMITTED: { count: 0, value: 0 },
    });
    expect(repPipeline.outcomes).toEqual({
      CLOSED: { count: 0, value: 0 },
      LOST: { count: 0, value: 0 },
    });
    expect(repPipeline.managerBreakdown).toBeUndefined();
    expect(repPipeline.personalPipeline).toBeUndefined();

    const managerRes = await managerTodayFullGET(
      makeRequest("http://localhost/api/today/manager-full", { userId: users.manager.id }),
    );
    expect(managerRes.status).toBe(200);
    const managerBody = await json<{
      today: {
        reps: Array<{ repId: string; criticalCount: number; attentionCount: number }>;
        drilldown: {
          critical: Array<{ dealId: string }>;
          attention: Array<{ dealId: string }>;
          upcoming: Array<{ dealId: string }>;
        };
      };
      insights: {
        atRiskDeals: Array<{ dealId: string; ownerId: string; value: number }>;
        interventions: Array<{ dealId: string }>;
        repHealth: Array<{ repId: string }>;
        expiredDealsSummary: { totalExpiredDeals: number; totalExpiredValue: number; byRep: unknown[] };
        expiringSoonDealsSummary: { totalExpiringSoon: number; totalValue: number; byRep: unknown[] };
      };
    }>(managerRes);

    const managerRepRows = managerBody.today.reps
      .map((rep) => ({
        repId: rep.repId,
        criticalCount: rep.criticalCount,
        attentionCount: rep.attentionCount,
      }))
      .sort((a, b) => a.repId.localeCompare(b.repId));
    expect(managerRepRows).toEqual(
      [
        { repId: users.manager.id, criticalCount: 0, attentionCount: 0 },
        { repId: users.rep.id, criticalCount: 1, attentionCount: 0 },
        { repId: repA2.id, criticalCount: 1, attentionCount: 0 },
      ].sort((a, b) => a.repId.localeCompare(b.repId)),
    );
    expect(managerBody.today.drilldown).toEqual({
      critical: [],
      attention: [],
      upcoming: [],
    });

    const atRisk = managerBody.insights.atRiskDeals
      .map((deal) => ({ dealId: deal.dealId, ownerId: deal.ownerId, value: deal.value }))
      .sort((a, b) => a.dealId.localeCompare(b.dealId));
    expect(atRisk).toEqual(
      [
        { dealId: deal1.id, ownerId: users.rep.id, value: 11_000 },
        { dealId: deal2.id, ownerId: repA2.id, value: 22_000 },
      ].sort((a, b) => a.dealId.localeCompare(b.dealId)),
    );
    expect(managerBody.insights.interventions.map((item) => item.dealId).sort()).toEqual([deal1.id, deal2.id].sort());
    expect(managerBody.insights.repHealth.map((rep) => rep.repId).sort()).toEqual(
      [users.manager.id, users.rep.id, repA2.id].sort(),
    );
    expect(managerBody.insights.expiredDealsSummary).toEqual({
      totalExpiredDeals: 0,
      totalExpiredValue: 0,
      byRep: [],
    });
    expect(managerBody.insights.expiringSoonDealsSummary).toEqual({
      totalExpiringSoon: 0,
      totalValue: 0,
      byRep: [],
    });

    const managerVisibleIds = new Set([
      ...managerBody.insights.atRiskDeals.map((deal) => deal.dealId),
      ...managerBody.insights.interventions.map((deal) => deal.dealId),
      ...managerBody.today.drilldown.critical.map((deal) => deal.dealId),
      ...managerBody.today.drilldown.attention.map((deal) => deal.dealId),
      ...managerBody.today.drilldown.upcoming.map((deal) => deal.dealId),
    ]);
    expect(managerVisibleIds.has(deal3.id)).toBe(false);
  });

  it("GET /api/pipeline returns admin managerBreakdown, computes stages, and applies product filtering", async () => {
    const productA = PRODUCT_OPTIONS[0];
    const productB = PRODUCT_OPTIONS[1];
    const accessDeal = await createAssignedDeal({ ownerId: users.rep.id, product: productA, value: 10_000 });
    const evaluationDeal = await createAssignedDeal({ ownerId: users.rep2.id, product: productB, value: 20_000 });
    await logInteraction({
      byUserId: users.rep2.id,
      dealId: evaluationDeal.id,
      outcome: Outcome.PROPOSAL_SHARED,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });

    const res = await pipelineGET(
      makeRequest("http://localhost/api/pipeline?includeOutcomes=1", { userId: users.admin.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      pipeline: Record<string, { count: number; value: number }>;
      managerBreakdown: Array<{ managerId: string; stages: Record<string, { count: number }> }>;
    }>(res);
    expect(body.pipeline.ACCESS.count).toBe(1);
    expect(body.pipeline.EVALUATION.count).toBe(1);
    expect(body.managerBreakdown.length).toBeGreaterThan(0);
    expect(body.managerBreakdown.find((row) => row.managerId === users.manager.id)?.stages.ACCESS.count).toBe(1);
    expect(body.managerBreakdown.find((row) => row.managerId === users.manager2.id)?.stages.EVALUATION.count).toBe(1);

    const filtered = await pipelineGET(
      makeRequest(`http://localhost/api/pipeline?includeOutcomes=1&product=${encodeURIComponent(productA)}`, {
        userId: users.admin.id,
      }),
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await json<{ pipeline: Record<string, { count: number }> }>(filtered);
    expect(filteredBody.pipeline.ACCESS.count).toBe(1);
    expect(filteredBody.pipeline.EVALUATION.count).toBe(0);
    expect(accessDeal.id).toBeTruthy();
  });

  it("derives deal stage and lifecycle state for new, active, and expired deals", async () => {
    expect(getDealStageFromOutcomes([])).toBe("ACCESS");
    const deal = await createAssignedDeal({ ownerId: users.rep.id });

    await expect(getDealBody(deal.id)).resolves.toMatchObject({
      stage: "ACCESS",
      status: DealStatus.ACTIVE,
    });

    await logInteraction({
      byUserId: users.rep.id,
      dealId: deal.id,
      outcome: Outcome.PROPOSAL_SHARED,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await expect(getDealBody(deal.id)).resolves.toMatchObject({
      stage: "EVALUATION",
      status: DealStatus.ACTIVE,
    });

    await prisma.deal.update({
      where: { id: deal.id },
      data: { lastActivityAt: daysAgo(46) },
    });
    await expect(getDealBody(deal.id)).resolves.toMatchObject({
      status: DealStatus.EXPIRED,
    });
  });

  it("computes stage deterministically when older weak logs conflict with newer strong logs", async () => {
    const baseTime = new Date("2026-04-28T08:00:00.000Z");
    const olderWeakAt = new Date(baseTime.getTime() - 60_000);
    const newerStrongAt = new Date(baseTime.getTime());
    const closeOlderWeakAt = new Date(baseTime.getTime() + 1_000);
    const closeNewerStrongAt = new Date(baseTime.getTime() + 1_001);

    const deal = await createAssignedDeal({ ownerId: users.rep.id });
    await prisma.interactionLog.createMany({
      data: [
        {
          dealId: deal.id,
          interactionType: InteractionType.CALL,
          outcome: Outcome.FOLLOW_UP_DONE,
          stakeholderType: StakeholderType.UNKNOWN,
          createdAt: olderWeakAt,
        },
        {
          dealId: deal.id,
          interactionType: InteractionType.CALL,
          outcome: Outcome.PROPOSAL_SHARED,
          stakeholderType: StakeholderType.DECISION_MAKER,
          createdAt: newerStrongAt,
        },
      ],
    });
    await prisma.deal.update({
      where: { id: deal.id },
      data: { lastActivityAt: newerStrongAt, status: DealStatus.ACTIVE },
    });

    const res = await dealGET(
      makeRequest(`http://localhost/api/deals/${deal.id}?includeLogs=true`, { userId: users.rep.id }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(200);
    const body = await json<{
      stage: string;
      status: DealStatus;
      logs: Array<{ outcome: Outcome; createdAt: string }>;
    }>(res);
    expect(body.stage).toBe("EVALUATION");
    expect(body.status).toBe(DealStatus.ACTIVE);
    expect(body.logs.map((log) => log.outcome)).toEqual([Outcome.PROPOSAL_SHARED, Outcome.FOLLOW_UP_DONE]);
    expect(body.logs.map((log) => new Date(log.createdAt).toISOString())).toEqual([
      newerStrongAt.toISOString(),
      olderWeakAt.toISOString(),
    ]);

    const closeTimestampDeal = await createAssignedDeal({ ownerId: users.rep.id });
    await prisma.interactionLog.createMany({
      data: [
        {
          dealId: closeTimestampDeal.id,
          interactionType: InteractionType.CALL,
          outcome: Outcome.FOLLOW_UP_DONE,
          stakeholderType: StakeholderType.UNKNOWN,
          createdAt: closeOlderWeakAt,
        },
        {
          dealId: closeTimestampDeal.id,
          interactionType: InteractionType.CALL,
          outcome: Outcome.PROPOSAL_SHARED,
          stakeholderType: StakeholderType.DECISION_MAKER,
          createdAt: closeNewerStrongAt,
        },
      ],
    });
    await prisma.deal.update({
      where: { id: closeTimestampDeal.id },
      data: { lastActivityAt: closeNewerStrongAt, status: DealStatus.ACTIVE },
    });

    const closeTimestampRes = await dealGET(
      makeRequest(`http://localhost/api/deals/${closeTimestampDeal.id}?includeLogs=true`, { userId: users.rep.id }),
      { params: Promise.resolve({ id: closeTimestampDeal.id }) },
    );
    expect(closeTimestampRes.status).toBe(200);
    const closeTimestampBody = await json<{
      stage: string;
      status: DealStatus;
      logs: Array<{ outcome: Outcome; createdAt: string }>;
    }>(closeTimestampRes);
    expect(closeTimestampBody.stage).toBe("EVALUATION");
    expect(closeTimestampBody.status).toBe(DealStatus.ACTIVE);
    expect(closeTimestampBody.logs.map((log) => log.outcome)).toEqual([
      Outcome.PROPOSAL_SHARED,
      Outcome.FOLLOW_UP_DONE,
    ]);
    expect(closeTimestampBody.logs.map((log) => new Date(log.createdAt).toISOString())).toEqual([
      closeNewerStrongAt.toISOString(),
      closeOlderWeakAt.toISOString(),
    ]);
  });

  it("POST /api/logs creates a log, updates activity timestamp, and changes derived stage", async () => {
    const deal = await createAssignedDeal({ ownerId: users.rep.id });
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });

    const res = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId: deal.id,
          interactionType: "CALL",
          outcome: Outcome.PROPOSAL_SHARED,
          stakeholderType: StakeholderType.DECISION_MAKER,
          risks: ["BUDGET_NOT_CONFIRMED"],
          nextStepType: "FOLLOW_UP",
          nextStepDate: daysFromNow(2).toISOString(),
        },
      }),
    );

    expect(res.status).toBe(201);
    await expect(prisma.interactionLog.count({ where: { dealId: deal.id } })).resolves.toBe(1);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.lastActivityAt.getTime());
    await expect(getDealBody(deal.id)).resolves.toMatchObject({ stage: "EVALUATION" });
  });

  it("GET /api/accounts/dashboard returns admin data and scoped non-admin data", async () => {
    const repAccount = await json<{ id: string }>(
      await createAccount({ byUserId: users.rep.id, name: nextName("Rep Requested") }),
    );
    const managerAccount = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: nextName("Manager Account") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: managerAccount.id });
    await assignAccount({
      byUserId: users.admin.id,
      accountId: managerAccount.id,
      assigneeId: users.rep.id,
    });

    const adminRes = await accountsDashboardGET(
      makeRequest("http://localhost/api/accounts/dashboard", { userId: users.admin.id }),
    );
    expect(adminRes.status).toBe(200);
    const admin = await json<{ accounts: unknown[]; users: unknown[]; pending: Array<{ id: string }> }>(adminRes);
    expect(admin.accounts.length).toBeGreaterThanOrEqual(2);
    expect(admin.users.length).toBeGreaterThanOrEqual(5);
    expect(admin.pending).toEqual([expect.objectContaining({ id: repAccount.id })]);

    const repRes = await accountsDashboardGET(
      makeRequest("http://localhost/api/accounts/dashboard", { userId: users.rep.id }),
    );
    expect(repRes.status).toBe(200);
    const rep = await json<{ accounts: Array<{ id: string }>; users: unknown[]; pending: unknown[] }>(repRes);
    expect(rep.accounts.map((account) => account.id)).toEqual([managerAccount.id]);
    expect(rep.users).toEqual([]);
    expect(rep.pending).toEqual([]);
  });

  it("enforces deal access for own deals, manager team deals, and anonymous requests", async () => {
    const repDeal = await createAssignedDeal({ ownerId: users.rep.id });
    const rep2Deal = await createAssignedDeal({ ownerId: users.rep2.id });

    const anonymous = await dealsGET(makeRequest("http://localhost/api/deals"));
    expect(anonymous.status).toBe(401);

    const repRes = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    expect(repRes.status).toBe(200);
    const repDeals = await json<Array<{ id: string }>>(repRes);
    expect(repDeals.map((deal) => deal.id)).toEqual([repDeal.id]);

    const managerRes = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
    expect(managerRes.status).toBe(200);
    const managerDeals = await json<Array<{ id: string }>>(managerRes);
    expect(managerDeals.map((deal) => deal.id)).toEqual([repDeal.id]);
    expect(managerDeals.some((deal) => deal.id === rep2Deal.id)).toBe(false);
  });
});
