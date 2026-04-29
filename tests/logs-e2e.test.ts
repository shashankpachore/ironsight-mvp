import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { createAccount, approveAccount, assignAccount, createDeal, logInteraction, json, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";

describe("logs e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let rep2DealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Log1") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 100, accountId: a1.id }),
    )).id;

    const a2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Log2") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });
    rep2DealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: PRODUCT_OPTIONS[0], value: 100, accountId: a2.id }),
    )).id;
  });

  it("cannot log without deal", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: "missing-deal" });
    expect(res.status).toBe(404);
  });

  it("allows no risk while deal remains in ACCESS", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, risks: [] });
    expect(res.status).toBe(201);
  });

  it("max 3 risks enforced", async () => {
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

  it("correct stakeholder required", async () => {
    const res = await logInteraction({
      byUserId: users.rep.id,
      dealId: repDealId,
      stakeholderType: "INVALID" as unknown as StakeholderType,
    });
    expect(res.status).toBe(400);
  });

  it("rep only logs own deals", async () => {
    const ok = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    const denied = await logInteraction({ byUserId: users.rep.id, dealId: rep2DealId, outcome: Outcome.NO_RESPONSE });
    expect(ok.status).toBe(201);
    expect(denied.status).toBe(403);
  });
});
