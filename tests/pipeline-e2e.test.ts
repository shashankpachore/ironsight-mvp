import { beforeEach, describe, expect, it } from "vitest";
import { InteractionType, Outcome, StakeholderType } from "@prisma/client";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { GET as managerBreakdownGET } from "../app/api/pipeline/manager-breakdown/route";
import { createAccount, approveAccount, assignAccount, createDeal, json, logInteraction, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

const STAGES = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED"] as const;

function totalPipelineCount(pipeline: Record<string, { count: number }>) {
  return Object.values(pipeline).reduce((sum, row) => sum + row.count, 0);
}

function totalPipelineValue(pipeline: Record<string, { value: number }>) {
  return Object.values(pipeline).reduce((sum, row) => sum + row.value, 0);
}

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
    expect(body.QUALIFIED.count + body.ACCESS.count + body.EVALUATION.count + body.COMMITTED.count).toBeGreaterThan(0);
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

  it("admin gets manager-level pipeline breakdown", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: users.manager.id } });

    const res = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown", { userId: users.admin.id }),
    );
    const body = await json<
      Array<{
        managerId: string;
        managerName: string;
        stages: Record<string, { count: number; value: number }>;
        totalValue: number;
      }>
    >(res);

    expect(res.status).toBe(200);
    const managerRow = body.find((row) => row.managerId === users.manager.id);
    expect(managerRow).toBeTruthy();
    const totalCount = managerRow
      ? Object.values(managerRow.stages).reduce((sum, stage) => sum + stage.count, 0)
      : 0;
    expect(totalCount).toBe(2);
    expect(managerRow?.totalValue).toBe(300);
  });

  it("manager breakdown endpoint denies non-admin users", async () => {
    const repRes = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown", { userId: users.rep.id }),
    );
    const managerRes = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown", { userId: users.manager.id }),
    );
    expect(repRes.status).toBe(403);
    expect(managerRes.status).toBe(403);
  });

  it("manager breakdown endpoint requires authentication", async () => {
    const res = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown"),
    );
    expect(res.status).toBe(401);
  });

  it("admin manager-breakdown partitions total pipeline including Unassigned", async () => {
    const managerAccount = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeMgrAssigned") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: managerAccount.id });
    await assignAccount({
      byUserId: users.admin.id,
      accountId: managerAccount.id,
      assigneeId: users.manager.id,
    });
    await createDeal({
      byUserId: users.manager.id,
      name: PRODUCT_OPTIONS[0],
      value: 150,
      accountId: managerAccount.id,
    });

    const unassignedAccount = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeUnassigned") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: unassignedAccount.id });
    await prisma.deal.create({
      data: {
        name: PRODUCT_OPTIONS[0],
        companyName: "Unassigned Co",
        value: 250,
        ownerId: users.admin.id,
        accountId: unassignedAccount.id,
      },
    });

    const totalRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const totalBody = await json<Record<string, { count: number; value: number }>>(totalRes);
    expect(totalRes.status).toBe(200);

    const breakdownRes = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown", { userId: users.admin.id }),
    );
    const breakdownBody = await json<ManagerBreakdownRow[]>(breakdownRes);
    expect(breakdownRes.status).toBe(200);

    const stageCountSumFromBreakdown = STAGES.reduce(
      (sum, stage) => sum + breakdownBody.reduce((rowsSum, row) => rowsSum + row.stages[stage].count, 0),
      0,
    );
    const totalValueFromBreakdown = breakdownBody.reduce((sum, row) => sum + row.totalValue, 0);

    expect(stageCountSumFromBreakdown).toBe(totalPipelineCount(totalBody));
    expect(totalValueFromBreakdown).toBe(totalPipelineValue(totalBody));
    expect(breakdownBody.some((row) => row.managerId === "UNASSIGNED")).toBe(true);
  });

  it("lost deals are terminal and excluded from active pipeline totals", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });

    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const body = await json<Record<string, { count: number }>>(res);
    expect(res.status).toBe(200);
    expect(Object.values(body).reduce((sum, row) => sum + row.count, 0)).toBe(1);
  });

  it("pipeline outcomes endpoint reports CLOSED and LOST separately", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await prisma.interactionLog.create({
      data: {
        dealId: rep2DealId,
        interactionType: InteractionType.CALL,
        outcome: Outcome.DEAL_CONFIRMED,
        stakeholderType: StakeholderType.DECISION_MAKER,
      },
    });
    await prisma.interactionLog.create({
      data: {
        dealId: rep2DealId,
        interactionType: InteractionType.CALL,
        outcome: Outcome.PO_RECEIVED,
        stakeholderType: StakeholderType.DECISION_MAKER,
      },
    });

    const res = await pipelineGET(
      makeRequest("http://localhost/api/pipeline?includeOutcomes=1", { userId: users.admin.id }),
    );
    const body = await json<{
      totals: Record<string, { count: number; value: number }>;
      outcomes: { CLOSED: { count: number; value: number }; LOST: { count: number; value: number } };
    }>(res);
    expect(res.status).toBe(200);
    expect(Object.values(body.totals).reduce((sum, row) => sum + row.count, 0)).toBe(0);
    expect(body.outcomes.CLOSED.count).toBe(1);
    expect(body.outcomes.CLOSED.value).toBe(200);
    expect(body.outcomes.LOST.count).toBe(1);
    expect(body.outcomes.LOST.value).toBe(100);
  });

  it("manager breakdown reports terminal outcomes separately per manager row", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: users.manager.id } });
    await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
    });
    await prisma.interactionLog.create({
      data: {
        dealId: rep2DealId,
        interactionType: InteractionType.CALL,
        outcome: Outcome.DEAL_CONFIRMED,
        stakeholderType: StakeholderType.DECISION_MAKER,
      },
    });
    await prisma.interactionLog.create({
      data: {
        dealId: rep2DealId,
        interactionType: InteractionType.CALL,
        outcome: Outcome.PO_RECEIVED,
        stakeholderType: StakeholderType.DECISION_MAKER,
      },
    });

    const res = await managerBreakdownGET(
      makeRequest("http://localhost/api/pipeline/manager-breakdown", { userId: users.admin.id }),
    );
    const body = await json<
      Array<{
        managerId: string;
        outcomes: { CLOSED: { count: number; value: number }; LOST: { count: number; value: number } };
      }>
    >(res);
    expect(res.status).toBe(200);
    const managerRow = body.find((row) => row.managerId === users.manager.id);
    expect(managerRow?.outcomes.CLOSED.count).toBe(1);
    expect(managerRow?.outcomes.CLOSED.value).toBe(200);
    expect(managerRow?.outcomes.LOST.count).toBe(1);
    expect(managerRow?.outcomes.LOST.value).toBe(100);
  });
});
