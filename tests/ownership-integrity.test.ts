import { beforeEach, describe, expect, it } from "vitest";
import { GET as dealGET } from "../app/api/deals/[id]/route";
import { GET as logsGET } from "../app/api/logs/[dealId]/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { defaultNextStepRequestFields } from "../lib/next-step";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

describe("deal ownership integrity under account mutation", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("Owner") }),
    );
    accountId = account.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    dealId = (await json<{ id: string }>(await createDeal({ byUserId: users.rep.id, accountId, value: 123, name: PRODUCT_OPTIONS[0] }))).id;
  });

  it("deal remains linked to original account after reassignment", async () => {
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.rep2.id });
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal?.accountId).toBe(accountId);
  });

  it("old rep cannot view deal after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const res = await dealGET(makeRequest(`http://localhost/api/deals/${dealId}`, { userId: users.rep.id }), { params: Promise.resolve({ id: dealId }) });
    expect(res.status).toBe(403);
  });

  it("new rep can view deal after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const res = await dealGET(makeRequest(`http://localhost/api/deals/${dealId}`, { userId: users.rep2.id }), { params: Promise.resolve({ id: dealId }) });
    expect(res.status).toBe(200);
  });

  it("old rep cannot log interactions after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
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
    expect(res.status).toBe(403);
  });

  it("new rep can log interactions after reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const res = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep2.id,
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
    expect(res.status).toBe(201);
  });

  it("logs visibility follows reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep2.id,
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
    const oldView = await logsGET(makeRequest(`http://localhost/api/logs/${dealId}`, { userId: users.rep.id }), { params: Promise.resolve({ dealId }) });
    const newView = await logsGET(makeRequest(`http://localhost/api/logs/${dealId}`, { userId: users.rep2.id }), { params: Promise.resolve({ dealId }) });
    expect(oldView.status).toBe(403);
    expect(newView.status).toBe(200);
  });

  it("unassigned account blocks all rep log writes", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { assignedToId: null } });
    const a = await logsPOST(
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
    const b = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep2.id,
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
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });
});
