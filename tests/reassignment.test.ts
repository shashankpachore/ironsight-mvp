import { beforeEach, describe, expect, it } from "vitest";
import { GET as dealsGET } from "../app/api/deals/route";
import { GET as dealStageGET } from "../app/api/deals/[id]/stage/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { defaultNextStepRequestFields } from "../lib/next-step";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";

describe("manager/account reassignment stress tests", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("Reassign") }),
    );
    accountId = account.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    dealId = (
      await json<{ id: string }>(
        await createDeal({
          byUserId: users.rep.id,
          accountId,
          value: 100,
          name: PRODUCT_OPTIONS[0],
        }),
      )
    ).id;
  });

  it("changing rep.managerId removes old manager pipeline visibility", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    const oldVisible = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    expect(oldVisible.status).toBe(200);

    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager2.id } });

    const oldMgrPipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    const body = (await oldMgrPipe.json()) as Record<string, { count: number }>;
    const total = Object.values(body).reduce((sum, stage) => sum + stage.count, 0);
    expect(total).toBe(0);
  });

  it("new manager gains visibility after managerId reassignment", async () => {
    const mgr2 = await prisma.user.create({
      data: { name: "Manager3", email: "manager3@ironsight.local", password: "test1234", role: "MANAGER" },
    });
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: mgr2.id } });
    const pipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: mgr2.id }));
    const body = (await pipe.json()) as Record<string, { count: number }>;
    const total = Object.values(body).reduce((sum, stage) => sum + stage.count, 0);
    expect(total).toBe(1);
  });

  it("account reassignment REP A -> REP B revokes old rep access", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const repDeals = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    const rows = (await repDeals.json()) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === dealId)).toBe(false);
  });

  it("account reassignment REP A -> REP B grants new rep access", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const repDeals = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep2.id }));
    const rows = (await repDeals.json()) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === dealId)).toBe(true);
  });

  it("existing deals remain valid after account reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal).toBeTruthy();
    expect(deal?.accountId).toBe(accountId);
  });

  it("unassigned account blocks logging actions", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { assignedToId: null } });
    const log = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.NO_RESPONSE,
          stakeholderType: StakeholderType.UNKNOWN,
          risks: [RiskCategory.NO_ACCESS_TO_DM],
          ...defaultNextStepRequestFields(Outcome.NO_RESPONSE),
        },
      }),
    );
    expect(log.status).toBe(400);
  });

  it("deal stage endpoint remains consistent during reassignment loops", async () => {
    for (let i = 0; i < 5; i++) {
      await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: i % 2 ? users.rep.id : users.rep2.id });
    }
    const stage = await dealStageGET(
      makeRequest(`http://localhost/api/deals/${dealId}/stage`, { userId: users.rep2.id }),
      { params: Promise.resolve({ id: dealId }) },
    );
    expect([200, 403]).toContain(stage.status);
  });
});
