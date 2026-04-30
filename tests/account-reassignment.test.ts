import { beforeEach, describe, expect, it } from "vitest";
import { GET as dealsGET } from "../app/api/deals/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { defaultNextStepRequestFields } from "../lib/next-step";
import { approveAccount, assignAccount, createAccount, createDeal, json, logInteraction, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";

describe("account reassignment effects", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("AccRe") }));
    accountId = acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    dealId = (await json<{ id: string }>(await createDeal({ byUserId: users.rep.id, accountId, value: 100, name: PRODUCT_OPTIONS[0] }))).id;
  });

  it("REP A loses deal access immediately after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const res = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.some((d) => d.id === dealId)).toBe(false);
  });

  it("REP B gains deal access immediately after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const res = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep2.id }));
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.some((d) => d.id === dealId)).toBe(true);
  });

  it("existing deals remain valid after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal?.accountId).toBe(accountId);
  });

  it("reassignment updates active deal ownerId to new assignee", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal?.ownerId).toBe(users.rep2.id);
    expect(deal?.terminalStage).toBeNull();
    expect(deal?.terminalOwnerId).toBeNull();
  });

  it("reassignment clears manager co-owner when active deal becomes rep-owned", async () => {
    const managerAccount = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("ManagerOwnedReassign") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: managerAccount.id });
    await assignAccount({ byUserId: users.admin.id, accountId: managerAccount.id, assigneeId: users.manager.id });
    const managerDeal = await json<{ id: string }>(
      await createDeal({
        byUserId: users.manager.id,
        accountId: managerAccount.id,
        value: 100,
        name: PRODUCT_OPTIONS[0],
        coOwnerId: users.manager2.id,
      }),
    );

    await assignAccount({ byUserId: users.admin.id, accountId: managerAccount.id, assigneeId: users.rep.id });
    const deal = await prisma.deal.findUnique({
      where: { id: managerDeal.id },
      select: { ownerId: true, coOwnerId: true },
    });
    expect(deal?.ownerId).toBe(users.rep.id);
    expect(deal?.coOwnerId).toBeNull();
  });

  it("reassignment does not change terminal deal ownerId", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_PREFERRED],
      notes: "Marked lost before reassignment",
    });
    const before = await prisma.deal.findUnique({ where: { id: dealId }, select: { ownerId: true } });
    const terminalBefore = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const after = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { ownerId: true, terminalStage: true, terminalOwnerId: true },
    });
    expect(before?.ownerId).toBe(users.rep.id);
    expect(after?.ownerId).toBe(users.rep.id);
    expect(terminalBefore?.terminalStage).toBe("LOST");
    expect(terminalBefore?.terminalOwnerId).toBe(users.rep.id);
    expect(after?.terminalStage).toBe("LOST");
    expect(after?.terminalOwnerId).toBe(users.rep.id);
  });

  it("closed transition stamps terminal ownership once", async () => {
    await prisma.interactionLog.createMany({
      data: [
        {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.MET_DECISION_MAKER,
          stakeholderType: StakeholderType.DECISION_MAKER,
        },
        {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.BUDGET_DISCUSSED,
          stakeholderType: StakeholderType.DECISION_MAKER,
        },
        {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.PROPOSAL_SHARED,
          stakeholderType: StakeholderType.DECISION_MAKER,
        },
      ],
    });
    const first = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.DEAL_CONFIRMED,
          stakeholderType: StakeholderType.DECISION_MAKER,
          risks: [RiskCategory.COMPETITOR_INVOLVED],
          ...defaultNextStepRequestFields(Outcome.DEAL_CONFIRMED),
        },
      }),
    );
    expect(first.status).toBe(201);

    const second = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.PO_RECEIVED,
          stakeholderType: StakeholderType.DECISION_MAKER,
          risks: [],
          ...defaultNextStepRequestFields(Outcome.PO_RECEIVED),
        },
      }),
    );
    expect(second.status).toBe(201);

    const dealAfterClose = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { ownerId: true, terminalStage: true, terminalOwnerId: true },
    });
    expect(dealAfterClose?.terminalStage).toBe("CLOSED");
    expect(dealAfterClose?.terminalOwnerId).toBe(dealAfterClose?.ownerId);

    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const dealAfterReassign = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { ownerId: true, terminalStage: true, terminalOwnerId: true },
    });
    expect(dealAfterReassign?.terminalStage).toBe("CLOSED");
    expect(dealAfterReassign?.terminalOwnerId).toBe(dealAfterClose?.terminalOwnerId);
  });

  it("unassigned account blocks logging writes", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { assignedToId: null } });
    const res = await logsPOST(
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
    expect(res.status).toBe(400);
  });
});
