import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, StakeholderType } from "@prisma/client";
import { GET as exportGET } from "../app/api/export/route";
import { GET as stageGET } from "../app/api/deals/[id]/stage/route";
import { createAccount, approveAccount, assignAccount, createDeal, json, logInteraction, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";

describe("adversarial e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let repAccountId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Adv") }));
    repAccountId = acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 100, accountId: acc.id }),
    )).id;
  });

  it("fake commitment attempt blocked", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED });
    expect(res.status).toBe(400);
  });

  it("proposal without value blocked at deal creation", async () => {
    const badDeal = await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 0, accountId: repAccountId });
    expect(badDeal.status).toBe(400);
  });

  it("direct PO attempt blocked", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PO_RECEIVED });
    expect(res.status).toBe(400);
  });

  it("no-movement spam should not elevate stage", async () => {
    for (let i = 0; i < 5; i++) {
      await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    }
    const stageRes = await stageGET(
      makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }),
      { params: Promise.resolve({ id: repDealId }) },
    );
    const body = await json<{ stage: string }>(stageRes);
    expect(body.stage).toBe("ACCESS");
  });

  it("reassignment abuse revokes previous rep access immediately", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId: repAccountId, assigneeId: users.rep2.id });
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("cross-user access attempt denied", async () => {
    const res = await logInteraction({ byUserId: users.rep2.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("export data leakage attempt blocked for rep", async () => {
    const res = await exportGET(makeRequest("http://localhost/api/export", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("dropped deal moves to LOST even after proposal", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_DROPPED });
    const stageRes = await stageGET(
      makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }),
      { params: Promise.resolve({ id: repDealId }) },
    );
    const body = await json<{ stage: string }>(stageRes);
    expect(body.stage).toBe("LOST");
  });
});
