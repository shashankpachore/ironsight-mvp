import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, StakeholderType } from "@prisma/client";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { createAccount, approveAccount, assignAccount, createDeal, json, logInteraction, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

describe("pipeline e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let rep2DealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();

    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Pipe1") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 100, accountId: a1.id }),
    )).id;

    const a2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Pipe2") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });
    rep2DealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: PRODUCT_OPTIONS[0], value: 200, accountId: a2.id }),
    )).id;
  });

  it("stage computed contributes to distribution", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id }));
    const body = await json<Record<string, { count: number }>>(res);
    expect(res.status).toBe(200);
    expect(body.QUALIFIED.count + body.ACCESS.count + body.EVALUATION.count + body.COMMITTED.count + body.CLOSED.count).toBeGreaterThan(0);
  });

  it("rep sees own pipeline only", async () => {
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id }));
    const body = await json<Record<string, { count: number }>>(res);
    const total = Object.values(body).reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(1);
  });

  it("manager sees team pipeline", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: users.manager.id } });
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    const body = await json<Record<string, { count: number }>>(res);
    const total = Object.values(body).reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(2);
  });

  it("manager breakdown includes direct reports when requested", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: users.manager.id } });
    const res = await pipelineGET(
      makeRequest("http://localhost/api/pipeline?includeRepBreakdown=1", { userId: users.manager.id }),
    );
    const body = await json<{
      totals: Record<string, { count: number }>;
      repPipelines: Array<{ repId: string; pipeline: Record<string, { count: number }> }>;
    }>(res);
    expect(res.status).toBe(200);
    expect(body.repPipelines.map((row) => row.repId).sort()).toEqual([users.rep.id, users.rep2.id].sort());
    const totalsCount = Object.values(body.totals).reduce((sum, row) => sum + row.count, 0);
    expect(totalsCount).toBe(2);
  });

  it("admin sees all pipeline", async () => {
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const body = await json<Record<string, { count: number }>>(res);
    const total = Object.values(body).reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(2);
  });

  it("distribution count matches number of visible deals", async () => {
    const repRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep2.id }));
    const repBody = await json<Record<string, { count: number }>>(repRes);
    const repTotal = Object.values(repBody).reduce((sum, row) => sum + row.count, 0);
    expect(repTotal).toBe(1);
  });
});
