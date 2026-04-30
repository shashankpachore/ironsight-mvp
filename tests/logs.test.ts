import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { GET as getLogsByDealRoute } from "../app/api/logs/[dealId]/route";
import { prismaTest as prisma } from "../lib/test-prisma";
import { json, makeRequest, resetDbAndSeedUsers, createAccount, approveAccount, assignAccount, createDeal, logInteraction, uniqueName } from "./helpers";

describe("interaction logs - validation and abuse tests", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let rep2DealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("LogAcc1") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc1.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: uniqueName("LogDeal1"), value: 100, accountId: acc1.id }),
    )).id;

    const acc2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("LogAcc2") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc2.id, assigneeId: users.rep2.id });
    rep2DealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: uniqueName("LogDeal2"), value: 200, accountId: acc2.id }),
    )).id;
  });

  it("cannot log without existing deal", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: "missing-deal" });
    expect(res.status).toBe(404);
  });

  it("allows no risk while deal remains in ACCESS", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, risks: [] });
    expect(res.status).toBe(201);
  });

  it("cannot exceed 3 risks", async () => {
    const res = await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      risks: [
        RiskCategory.NO_ACCESS_TO_DM,
        RiskCategory.STUCK_WITH_INFLUENCER,
        RiskCategory.BUDGET_NOT_DISCUSSED,
        RiskCategory.COMPETITOR_INVOLVED,
      ],
    });
    expect(res.status).toBe(400);
  });

  it("stakeholder required", async () => {
    const res = await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      stakeholderType: "INVALID_STAKEHOLDER" as unknown as StakeholderType,
    });
    expect(res.status).toBe(400);
  });

  it("outcome required", async () => {
    const res = await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      outcome: "INVALID_OUTCOME" as unknown as Outcome,
    });
    expect(res.status).toBe(400);
  });

  it("rep can log on assigned deal", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(201);
  });

  it("co-owner can log on a deal", async () => {
    await prisma.deal.update({ where: { id: repDealId }, data: { coOwnerId: users.rep2.id } });
    const res = await logInteraction({ byUserId: users.rep2.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(201);
  });

  it("manager can log when they own or co-own the deal", async () => {
    const managerAcc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("ManagerLogAcc") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: managerAcc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: managerAcc.id, assigneeId: users.manager.id });
    const managerOwnedDeal = await json<{ id: string }>(
      await createDeal({
        byUserId: users.manager.id,
        name: uniqueName("ManagerOwnedLogDeal"),
        value: 100,
        accountId: managerAcc.id,
      }),
    );
    const ownerLogRes = await logInteraction({
      byUserId: users.manager.id,
      dealId: managerOwnedDeal.id,
      outcome: Outcome.NO_RESPONSE,
    });
    expect(ownerLogRes.status).toBe(201);

    const coOwnedDeal = await json<{ id: string }>(
      await createDeal({
        byUserId: users.manager.id,
        name: uniqueName("ManagerCoOwnedLogDeal"),
        value: 100,
        accountId: managerAcc.id,
        coOwnerId: users.manager2.id,
      }),
    );
    const coOwnerLogRes = await logInteraction({
      byUserId: users.manager2.id,
      dealId: coOwnedDeal.id,
      outcome: Outcome.NO_RESPONSE,
    });
    expect(coOwnerLogRes.status).toBe(201);
  });

  it("rep cannot log on unassigned deal", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: rep2DealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("manager cannot log on deal assigned to rep (strict assigned-user rule)", async () => {
    const res = await logInteraction({ byUserId: users.manager.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("admin cannot log on deal assigned to rep (strict assigned-user rule)", async () => {
    const res = await logInteraction({ byUserId: users.admin.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("cannot log if account becomes unassigned", async () => {
    const deal = await prisma.deal.findUnique({ where: { id: repDealId }, include: { account: true } });
    await prisma.account.update({ where: { id: deal!.accountId }, data: { assignedToId: null } });
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(400);
  });

  it("deal_confirmed is blocked without prerequisite outcomes", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED });
    expect(res.status).toBe(400);
  });

  it("po_received blocked if deal_confirmed missing", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PO_RECEIVED });
    expect(res.status).toBe(400);
  });

  it("deal_confirmed succeeds after prerequisites logged", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED, stakeholderType: StakeholderType.DECISION_MAKER });
    expect(res.status).toBe(201);
  });

  it("po_received succeeds after deal_confirmed", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PO_RECEIVED, stakeholderType: StakeholderType.DECISION_MAKER });
    expect(res.status).toBe(201);
  });

  it("logs endpoint returns risks flattened and sorted desc", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.FOLLOW_UP_DONE });
    const res = await getLogsByDealRoute(
      makeRequest(`http://localhost/api/logs/${repDealId}`, { userId: users.rep.id }),
      { params: Promise.resolve({ dealId: repDealId }) },
    );
    const rows = await json<Array<{ risks: string[] }>>(res);
    expect(res.status).toBe(200);
    expect(Array.isArray(rows[0].risks)).toBe(true);
  });

  it("stores and returns interaction participants", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      outcome: Outcome.NO_RESPONSE,
      participants: [users.rep.id, users.manager.id],
    });
    const res = await getLogsByDealRoute(
      makeRequest(`http://localhost/api/logs/${repDealId}`, { userId: users.rep.id }),
      { params: Promise.resolve({ dealId: repDealId }) },
    );
    const rows = await json<Array<{ participants: Array<{ id: string }> }>>(res);
    expect(res.status).toBe(200);
    expect(rows[0].participants.map((participant) => participant.id).sort()).toEqual(
      [users.manager.id, users.rep.id].sort(),
    );
  });

  it("rejects duplicate participants", async () => {
    const res = await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      outcome: Outcome.NO_RESPONSE,
      participants: [users.rep.id, users.rep.id],
    });
    expect(res.status).toBe(400);
  });

  it("rep forbidden from viewing logs of unassigned deal", async () => {
    const res = await getLogsByDealRoute(
      makeRequest(`http://localhost/api/logs/${rep2DealId}`, { userId: users.rep.id }),
      { params: Promise.resolve({ dealId: rep2DealId }) },
    );
    expect(res.status).toBe(403);
  });
});
