import { beforeEach, describe, expect, it } from "vitest";
import { DealStatus, InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { GET as dealsGET, POST as dealsPOST } from "../app/api/deals/route";
import { GET as stageGET } from "../app/api/deals/[id]/stage/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { GET as todayGET } from "../app/api/today/route";
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
type DealListItem = {
  id: string;
  name: string;
  stage: string;
  momentumStatus: "CRITICAL" | "STALE" | "AT_RISK" | "ON_TRACK";
  account: { assignedToId: string | null };
};

let users: Users;
let sequence = 0;

function nextName(label: string) {
  sequence += 1;
  return `Core ${label} ${sequence}`;
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

async function expectStage(dealId: string, stage: string, userId = users.rep.id) {
  const res = await stageGET(
    makeRequest(`http://localhost/api/deals/${dealId}/stage`, { userId }),
    { params: Promise.resolve({ id: dealId }) },
  );
  expect(res.status).toBe(200);
  await expect(json<{ stage: string }>(res)).resolves.toMatchObject({ stage });
}

async function moveToCommitted(dealId: string, userId = users.rep.id) {
  await logInteraction({
    byUserId: userId,
    dealId,
    outcome: Outcome.MET_DECISION_MAKER,
    stakeholderType: StakeholderType.DECISION_MAKER,
  });
  await logInteraction({
    byUserId: userId,
    dealId,
    outcome: Outcome.BUDGET_DISCUSSED,
    stakeholderType: StakeholderType.DECISION_MAKER,
  });
  await logInteraction({
    byUserId: userId,
    dealId,
    outcome: Outcome.PROPOSAL_SHARED,
    stakeholderType: StakeholderType.DECISION_MAKER,
  });
  await logInteraction({
    byUserId: userId,
    dealId,
    outcome: Outcome.DEAL_CONFIRMED,
    stakeholderType: StakeholderType.DECISION_MAKER,
  });
}

async function listDealIds(path: string, userId = users.admin.id) {
  const res = await dealsGET(makeRequest(`http://localhost${path}`, { userId }));
  expect(res.status).toBe(200);
  const rows = await json<Array<{ id: string }>>(res);
  return rows.map((deal) => deal.id);
}

function expectSameIds(actual: string[], expected: string[]) {
  expect(new Set(actual)).toEqual(new Set(expected));
}

beforeEach(async () => {
  sequence = 0;
  users = await resetDbAndSeedUsers();
});

describe("core business flows - simple baselines", () => {
  it("creates a deal through /api/deals and persists the expected product, owner, and ACTIVE status", async () => {
    const account = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: nextName("Create Account") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });

    const res = await dealsPOST(
      makeRequest("http://localhost/api/deals", {
        method: "POST",
        userId: users.rep.id,
        body: {
          name: PRODUCT_OPTIONS[0],
          value: 12_500,
          accountId: account.id,
        },
      }),
    );

    expect(res.status).toBe(201);
    const body = await json<{ id: string; name: string; status: DealStatus }>(res);
    const dbDeal = await prisma.deal.findUnique({ where: { id: body.id } });
    expect(body).toMatchObject({ name: PRODUCT_OPTIONS[0], status: DealStatus.ACTIVE });
    expect(dbDeal).toMatchObject({
      accountId: account.id,
      ownerId: users.rep.id,
      name: PRODUCT_OPTIONS[0],
      status: DealStatus.ACTIVE,
    });
  });

  it("progresses stage through real interaction logs", async () => {
    const deal = await createAssignedDeal({ ownerId: users.rep.id });

    await expectStage(deal.id, "ACCESS");
    await logInteraction({
      byUserId: users.rep.id,
      dealId: deal.id,
      outcome: Outcome.MET_DECISION_MAKER,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await logInteraction({
      byUserId: users.rep.id,
      dealId: deal.id,
      outcome: Outcome.BUDGET_DISCUSSED,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await expectStage(deal.id, "QUALIFIED");

    await logInteraction({
      byUserId: users.rep.id,
      dealId: deal.id,
      outcome: Outcome.PROPOSAL_SHARED,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await expectStage(deal.id, "EVALUATION");

    await logInteraction({
      byUserId: users.rep.id,
      dealId: deal.id,
      outcome: Outcome.DEAL_CONFIRMED,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await expectStage(deal.id, "COMMITTED");
  });

  it("filters /api/deals by product using strict product names and rejects invalid products", async () => {
    const productA = PRODUCT_OPTIONS[0];
    const productB = PRODUCT_OPTIONS[1];
    const dealA = await createAssignedDeal({ ownerId: users.rep.id, product: productA });
    const dealB = await createAssignedDeal({ ownerId: users.rep.id, product: productB });

    expectSameIds(
      await listDealIds(`/api/deals?product=${encodeURIComponent(productA)}`, users.rep.id),
      [dealA.id],
    );
    expectSameIds(
      await listDealIds(`/api/deals?product=${encodeURIComponent(productB)}`, users.rep.id),
      [dealB.id],
    );

    const invalid = await dealsGET(
      makeRequest("http://localhost/api/deals?product=Invalid%20Product", { userId: users.rep.id }),
    );
    expect(invalid.status).toBe(400);
    await expect(json<{ error: string }>(invalid)).resolves.toEqual({ error: "invalid product" });
  });

  it("returns 401 without a session and 403 for out-of-scope deal access", async () => {
    const deal = await createAssignedDeal({ ownerId: users.rep2.id });

    const anonymous = await dealsGET(makeRequest("http://localhost/api/deals"));
    expect(anonymous.status).toBe(401);

    const outOfScopeStage = await stageGET(
      makeRequest(`http://localhost/api/deals/${deal.id}/stage`, { userId: users.rep.id }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(outOfScopeStage.status).toBe(403);
  });
});

describe("core business flows - complex scenarios", () => {
  it("runs a full deal lifecycle without mixing lifecycle status and stage logic", async () => {
    const deal = await createAssignedDeal({ ownerId: users.rep.id });

    await expectStage(deal.id, "ACCESS");
    await moveToCommitted(deal.id);
    await expectStage(deal.id, "COMMITTED");

    await prisma.deal.update({
      where: { id: deal.id },
      data: { lastActivityAt: daysAgo(45) },
    });

    const expiredRead = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    expect(expiredRead.status).toBe(200);
    expect((await json<Array<{ id: string }>>(expiredRead)).some((row) => row.id === deal.id)).toBe(false);
    await expect(prisma.deal.findUnique({ where: { id: deal.id } }))
      .resolves.toMatchObject({ status: DealStatus.EXPIRED });

    const resurrect = await logInteraction({
      byUserId: users.rep.id,
      dealId: deal.id,
      outcome: Outcome.FOLLOW_UP_DONE,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_INVOLVED],
    });
    expect(resurrect.status).toBe(201);
    await expect(prisma.deal.findUnique({ where: { id: deal.id } }))
      .resolves.toMatchObject({ status: DealStatus.ACTIVE });
    await expectStage(deal.id, "COMMITTED");
  });

  it("combines product and stage filters without overriding either query parameter", async () => {
    const productA = PRODUCT_OPTIONS[0];
    const productB = PRODUCT_OPTIONS[1];
    const accessA = await createAssignedDeal({ ownerId: users.rep.id, product: productA });
    const committedA = await createAssignedDeal({ ownerId: users.rep.id, product: productA });
    const committedB = await createAssignedDeal({ ownerId: users.rep.id, product: productB });
    await moveToCommitted(committedA.id);
    await moveToCommitted(committedB.id);

    expectSameIds(
      await listDealIds(`/api/deals?product=${encodeURIComponent(productA)}`, users.rep.id),
      [committedA.id, accessA.id],
    );
    expectSameIds(
      await listDealIds("/api/deals?stage=COMMITTED", users.rep.id),
      [committedB.id, committedA.id],
    );
    expectSameIds(
      await listDealIds(`/api/deals?stage=COMMITTED&product=${encodeURIComponent(productA)}`, users.rep.id),
      [committedA.id],
    );
  });

  it("keeps ADMIN, MANAGER, and REP visibility scoped correctly across /api/deals and /api/pipeline", async () => {
    const repDeal = await createAssignedDeal({ ownerId: users.rep.id, value: 100 });
    const rep2Deal = await createAssignedDeal({ ownerId: users.rep2.id, value: 200 });

    const adminDeals = new Set(await listDealIds("/api/deals", users.admin.id));
    expect(adminDeals).toEqual(new Set([rep2Deal.id, repDeal.id]));

    const managerDeals = new Set(await listDealIds("/api/deals", users.manager.id));
    expect(managerDeals).toEqual(new Set([repDeal.id]));

    const repDeals = new Set(await listDealIds("/api/deals", users.rep.id));
    expect(repDeals).toEqual(new Set([repDeal.id]));

    const adminPipeline = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const managerPipeline = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    const repPipeline = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id }));
    expect(adminPipeline.status).toBe(200);
    expect(managerPipeline.status).toBe(200);
    expect(repPipeline.status).toBe(200);

    const countDeals = (pipeline: Record<string, { count: number }>) =>
      Object.values(pipeline).reduce((sum, stage) => sum + stage.count, 0);
    expect(countDeals(await json<Record<string, { count: number }>>(adminPipeline))).toBe(2);
    expect(countDeals(await json<Record<string, { count: number }>>(managerPipeline))).toBe(1);
    expect(countDeals(await json<Record<string, { count: number }>>(repPipeline))).toBe(1);
  });

  it("classifies Today and deal momentum for ON_TRACK, STALE, AT_RISK, and CRITICAL deals", async () => {
    const onTrack = await createAssignedDeal({ ownerId: users.rep.id, value: 100 });
    const stale = await createAssignedDeal({ ownerId: users.rep.id, value: 200 });
    const critical = await createAssignedDeal({ ownerId: users.rep.id, value: 300 });
    const atRisk = await createAssignedDeal({ ownerId: users.rep.id, value: 400 });

    await prisma.deal.update({
      where: { id: onTrack.id },
      data: { lastActivityAt: daysAgo(2), nextStepDate: daysFromNow(1), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: stale.id },
      data: { lastActivityAt: daysAgo(8), nextStepDate: daysFromNow(5), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: critical.id },
      data: { lastActivityAt: daysAgo(12), nextStepDate: daysFromNow(5), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: atRisk.id },
      data: { lastActivityAt: daysAgo(3), nextStepDate: daysFromNow(5), nextStepType: "FOLLOW_UP" },
    });
    await prisma.interactionLog.create({
      data: {
        dealId: atRisk.id,
        interactionType: InteractionType.CALL,
        outcome: Outcome.PROPOSAL_SHARED,
        stakeholderType: StakeholderType.DECISION_MAKER,
        createdAt: daysAgo(3),
      },
    });

    const dealsRes = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    expect(dealsRes.status).toBe(200);
    const deals = await json<DealListItem[]>(dealsRes);
    const momentumById = new Map(deals.map((deal) => [deal.id, deal.momentumStatus]));
    expect(momentumById.get(onTrack.id)).toBe("ON_TRACK");
    expect(momentumById.get(stale.id)).toBe("STALE");
    expect(momentumById.get(atRisk.id)).toBe("AT_RISK");
    expect(momentumById.get(critical.id)).toBe("CRITICAL");

    const todayRes = await todayGET(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
    expect(todayRes.status).toBe(200);
    const today = await json<{
      mode: "REP";
      critical: Array<{ dealId: string; reason: string }>;
      attention: Array<{ dealId: string; reason: string }>;
      upcoming: Array<{ dealId: string; reason: string }>;
    }>(todayRes);
    expect(today.mode).toBe("REP");
    expect(today.critical).toEqual([
      expect.objectContaining({ dealId: critical.id, reason: "Overdue or inactive too long" }),
    ]);
    expect(today.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dealId: stale.id, reason: "No recent activity" }),
        expect.objectContaining({ dealId: atRisk.id, reason: "Deal may lose momentum" }),
      ]),
    );
    expect(today.upcoming).toEqual([
      expect.objectContaining({ dealId: onTrack.id, reason: "On track" }),
    ]);
  });

  it("handles the 44-day and 45-day expiry boundary without an off-by-one error", async () => {
    const day44 = await createAssignedDeal({ ownerId: users.rep.id });
    const day45 = await createAssignedDeal({ ownerId: users.rep.id });
    await prisma.deal.update({
      where: { id: day44.id },
      data: { lastActivityAt: daysAgo(44) },
    });
    await prisma.deal.update({
      where: { id: day45.id },
      data: { lastActivityAt: daysAgo(45) },
    });

    const res = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    expect(res.status).toBe(200);
    const rows = await json<Array<{ id: string; expiryWarning: string | null }>>(res);
    expect(rows).toEqual([
      expect.objectContaining({ id: day44.id, expiryWarning: "EXPIRING_SOON" }),
    ]);
    await expect(prisma.deal.findUnique({ where: { id: day44.id } }))
      .resolves.toMatchObject({ status: DealStatus.ACTIVE });
    await expect(prisma.deal.findUnique({ where: { id: day45.id } }))
      .resolves.toMatchObject({ status: DealStatus.EXPIRED });
  });
});
