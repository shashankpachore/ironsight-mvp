import { beforeEach, describe, expect, it } from "vitest";
import { GET as dealsGET } from "../app/api/deals/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

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
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.rep2.id });
    const res = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep2.id }));
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.some((d) => d.id === dealId)).toBe(true);
  });

  it("existing deals remain valid after reassignment", async () => {
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.rep2.id });
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal?.accountId).toBe(accountId);
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
        },
      }),
    );
    expect(res.status).toBe(400);
  });
});
