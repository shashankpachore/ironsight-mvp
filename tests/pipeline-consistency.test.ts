import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, StakeholderType } from "@prisma/client";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { GET as managerBreakdownGET } from "../app/api/pipeline/manager-breakdown/route";
import { approveAccount, assignAccount, createAccount, createDeal, json, logInteraction, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";

function totalCount(p: Record<string, { count: number }>) {
  return Object.values(p).reduce((sum, row) => sum + row.count, 0);
}
function totalValue(p: Record<string, { value: number }>) {
  return Object.values(p).reduce((sum, row) => sum + row.value, 0);
}
const STAGES = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED"] as const;

describe("pipeline aggregation consistency under mutations", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let rep2DealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeC1") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(await createDeal({ byUserId: users.rep.id, accountId: a1.id, value: 100, name: PRODUCT_OPTIONS[0] }))).id;

    const a2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeC2") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });
    rep2DealId = (await json<{ id: string }>(await createDeal({ byUserId: users.rep2.id, accountId: a2.id, value: 300, name: PRODUCT_OPTIONS[0] }))).id;
  });

  it("admin pipeline count matches all deals", async () => {
    const pipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const body = (await pipe.json()) as Record<string, { count: number }>;
    expect(totalCount(body)).toBe(2);
  });

  it("admin pipeline value matches all visible deals", async () => {
    const pipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const body = (await pipe.json()) as Record<string, { value: number }>;
    expect(totalValue(body)).toBe(400);
  });

  it("after manager reassignment, old manager loses count and new manager gains count", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    const mgr2 = await prisma.user.create({
      data: { name: "Mgr2", email: "mgr2pipe@ironsight.local", password: "test1234", role: "MANAGER" },
    });
    await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: mgr2.id } });

    const oldMgr = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    const newMgr = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: mgr2.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(oldMgr)).toBe(1);
    expect(totalCount(newMgr)).toBe(1);
  });

  it("reassignment of account does not duplicate counts", async () => {
    const accountId = (await prisma.deal.findUnique({ where: { id: repDealId } }))!.accountId;
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const repPipe = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id })).then((r) => r.json())) as Record<string, { count: number }>;
    const rep2Pipe = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep2.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(repPipe)).toBe(0);
    expect(totalCount(rep2Pipe)).toBe(2);
  });

  it("stage transition updates distribution bucket consistently", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: StakeholderType.DECISION_MAKER });
    const pipe = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(pipe.QUALIFIED.count).toBe(1);
  });

  it("role downgrade manager->rep immediately changes visible pipeline", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    const before = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    await prisma.user.update({ where: { id: users.manager.id }, data: { role: "REP" } });
    const after = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(before)).toBe(1);
    expect(totalCount(after)).toBe(0);
  });

  it("invalid user session gets 401 and no aggregation leak", async () => {
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: "bad-user" }));
    expect(res.status).toBe(401);
  });

  it("admin manager-breakdown stage/value totals reconcile with admin total pipeline", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: users.manager2.id } });

    const unassigned = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeCUnassigned") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: unassigned.id });
    await prisma.deal.create({
      data: {
        name: PRODUCT_OPTIONS[0],
        companyName: "Unassigned Co",
        value: 500,
        ownerId: users.admin.id,
        accountId: unassigned.id,
      },
    });

    const totalRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const totals = (await totalRes.json()) as Record<string, { count: number; value: number }>;
    expect(totalRes.status).toBe(200);

    const breakdownRes = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown", { userId: users.admin.id }),
    );
    const rows = (await breakdownRes.json()) as Array<{
      managerId: string;
      stages: Record<(typeof STAGES)[number], { count: number; value: number }>;
      totalValue: number;
    }>;
    expect(breakdownRes.status).toBe(200);

    const breakdownCountTotal = STAGES.reduce(
      (sum, stage) => sum + rows.reduce((rowSum, row) => rowSum + row.stages[stage].count, 0),
      0,
    );
    const breakdownValueTotal = rows.reduce((sum, row) => sum + row.totalValue, 0);

    expect(breakdownCountTotal).toBe(totalCount(totals));
    expect(breakdownValueTotal).toBe(totalValue(totals));
    expect(rows.some((row) => row.managerId === "UNASSIGNED")).toBe(true);
  });
});
