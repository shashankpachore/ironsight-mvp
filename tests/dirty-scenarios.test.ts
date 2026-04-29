import { beforeEach, describe, expect, it } from "vitest";
import { DealStatus, InteractionType, Outcome, StakeholderType } from "@prisma/client";
import { GET as dealsGET } from "../app/api/deals/route";
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
  makeRequest,
  resetDbAndSeedUsers,
} from "./helpers";

const DAY_MS = 86_400_000;

type Users = Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

let users: Users;
let sequence = 0;

function nextName(label: string) {
  sequence += 1;
  return `Dirty ${label} ${sequence}`;
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

async function createAssignedDeal(params?: {
  ownerId?: string;
  product?: string;
  nextStepDate?: Date | null;
}) {
  const ownerId = params?.ownerId ?? users.rep.id;
  const account = await json<{ id: string }>(
    await createAccount({ byUserId: users.admin.id, name: nextName("Account") }),
  );
  await approveAccount({ byUserId: users.admin.id, accountId: account.id });
  await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: ownerId });
  const deal = await json<{ id: string }>(
    await createDeal({
      byUserId: ownerId,
      accountId: account.id,
      name: params?.product ?? PRODUCT_OPTIONS[0],
      value: 10_000,
    }),
  );
  if (params && "nextStepDate" in params) {
    await prisma.deal.update({
      where: { id: deal.id },
      data: {
        nextStepDate: params.nextStepDate,
        nextStepType: params.nextStepDate ? "FOLLOW_UP" : null,
      },
    });
  }
  return deal.id;
}

async function createLogs(dealId: string, rows: Array<{ outcome: Outcome; createdAt: Date }>) {
  await prisma.interactionLog.createMany({
    data: rows.map((row) => ({
      dealId,
      interactionType: InteractionType.CALL,
      outcome: row.outcome,
      stakeholderType: StakeholderType.DECISION_MAKER,
      createdAt: row.createdAt,
    })),
  });
}

async function getStage(dealId: string) {
  const res = await stageGET(
    makeRequest(`http://localhost/api/deals/${dealId}/stage`, { userId: users.rep.id }),
    { params: Promise.resolve({ id: dealId }) },
  );
  expect(res.status).toBe(200);
  return json<{ stage: string }>(res);
}

async function idsFromDeals(path: string) {
  const res = await dealsGET(makeRequest(`http://localhost${path}`, { userId: users.rep.id }));
  expect(res.status).toBe(200);
  return (await json<Array<{ id: string }>>(res)).map((deal) => deal.id);
}

beforeEach(async () => {
  sequence = 0;
  users = await resetDbAndSeedUsers();
});

describe("dirty scenarios", () => {
  it("keeps COMMITTED stage when older lower-stage interactions arrive after recent committed signals", async () => {
    const dealId = await createAssignedDeal();
    const recent = daysAgo(1);
    const older = daysAgo(20);

    await createLogs(dealId, [
      { outcome: Outcome.MET_DECISION_MAKER, createdAt: recent },
      { outcome: Outcome.BUDGET_DISCUSSED, createdAt: recent },
      { outcome: Outcome.PROPOSAL_SHARED, createdAt: recent },
      { outcome: Outcome.DEAL_CONFIRMED, createdAt: recent },
      { outcome: Outcome.MET_DECISION_MAKER, createdAt: older },
      { outcome: Outcome.BUDGET_DISCUSSED, createdAt: older },
    ]);

    await expect(getStage(dealId)).resolves.toEqual({ stage: "COMMITTED" });
  });

  it("handles duplicate noisy evaluation interactions without corrupting stage", async () => {
    const dealId = await createAssignedDeal();
    const timestamp = daysAgo(2);

    await createLogs(dealId, [
      { outcome: Outcome.DEMO_DONE, createdAt: timestamp },
      { outcome: Outcome.DEMO_DONE, createdAt: timestamp },
      { outcome: Outcome.DEMO_DONE, createdAt: timestamp },
      { outcome: Outcome.PROPOSAL_SHARED, createdAt: timestamp },
      { outcome: Outcome.PROPOSAL_SHARED, createdAt: timestamp },
    ]);

    await expect(getStage(dealId)).resolves.toEqual({ stage: "EVALUATION" });
  });

  it("omits valid staged deals with missing nextStepDate from Today without failing", async () => {
    const dealId = await createAssignedDeal({ nextStepDate: null });
    await createLogs(dealId, [
      { outcome: Outcome.MET_DECISION_MAKER, createdAt: daysAgo(1) },
      { outcome: Outcome.BUDGET_DISCUSSED, createdAt: daysAgo(1) },
      { outcome: Outcome.PROPOSAL_SHARED, createdAt: daysAgo(1) },
    ]);

    const res = await todayGET(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      critical: Array<{ dealId: string }>;
      attention: Array<{ dealId: string }>;
      upcoming: Array<{ dealId: string }>;
    }>(res);
    const visibleIds = new Set([
      ...body.critical.map((deal) => deal.dealId),
      ...body.attention.map((deal) => deal.dealId),
      ...body.upcoming.map((deal) => deal.dealId),
    ]);
    expect(visibleIds.has(dealId)).toBe(false);
  });

  it("persists EXPIRED status when /api/pipeline reads stale active deals", async () => {
    const dealId = await createAssignedDeal();
    await prisma.deal.update({
      where: { id: dealId },
      data: { lastActivityAt: daysAgo(50) },
    });

    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id }));
    expect(res.status).toBe(200);
    const pipeline = await json<Record<string, { count: number }>>(res);
    expect(Object.values(pipeline).reduce((sum, stage) => sum + stage.count, 0)).toBe(0);

    const afterRead = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(afterRead?.status).toBe(DealStatus.EXPIRED);
  });

  it("applies 44/45 day expiry boundary precisely when /api/deals performs write-back", async () => {
    const day44 = await createAssignedDeal({ nextStepDate: daysFromNow(1) });
    const day45 = await createAssignedDeal({ nextStepDate: daysFromNow(1) });
    await prisma.deal.update({
      where: { id: day44 },
      data: { lastActivityAt: daysAgo(44) },
    });
    await prisma.deal.update({
      where: { id: day45 },
      data: { lastActivityAt: daysAgo(45) },
    });

    expect(new Set(await idsFromDeals("/api/deals"))).toEqual(new Set([day44]));
    await expect(prisma.deal.findUnique({ where: { id: day44 } }))
      .resolves.toMatchObject({ status: DealStatus.ACTIVE });
    await expect(prisma.deal.findUnique({ where: { id: day45 } }))
      .resolves.toMatchObject({ status: DealStatus.EXPIRED });
  });
});
