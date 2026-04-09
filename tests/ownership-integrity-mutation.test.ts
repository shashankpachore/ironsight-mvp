import { beforeEach, describe, expect, it } from "vitest";
import { GET as dealGET } from "../app/api/deals/[id]/route";
import { GET as logsGET } from "../app/api/logs/[dealId]/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";

describe("ownership integrity under mutations", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("OwnMut") }));
    accountId = account.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    dealId = (await json<{ id: string }>(await createDeal({ byUserId: users.rep.id, accountId, value: 123, name: PRODUCT_OPTIONS[0] }))).id;
  });

  it("after reassignment, old rep cannot view or log and new rep can", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const oldView = await dealGET(makeRequest(`http://localhost/api/deals/${dealId}`, { userId: users.rep.id }), { params: Promise.resolve({ id: dealId }) });
    const newView = await dealGET(makeRequest(`http://localhost/api/deals/${dealId}`, { userId: users.rep2.id }), { params: Promise.resolve({ id: dealId }) });
    expect(oldView.status).toBe(403);
    expect(newView.status).toBe(200);

    const oldLog = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: { dealId, interactionType: InteractionType.CALL, outcome: Outcome.NO_RESPONSE, stakeholderType: StakeholderType.UNKNOWN, risks: [RiskCategory.NO_ACCESS_TO_DM] },
      }),
    );
    const newLog = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep2.id,
        body: { dealId, interactionType: InteractionType.CALL, outcome: Outcome.NO_RESPONSE, stakeholderType: StakeholderType.UNKNOWN, risks: [RiskCategory.NO_ACCESS_TO_DM] },
      }),
    );
    expect(oldLog.status).toBe(403);
    expect(newLog.status).toBe(201);
  });

  it("logs endpoint enforces updated ownership boundaries", async () => {
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.rep2.id });
    await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep2.id,
        body: { dealId, interactionType: InteractionType.CALL, outcome: Outcome.NO_RESPONSE, stakeholderType: StakeholderType.UNKNOWN, risks: [RiskCategory.NO_ACCESS_TO_DM] },
      }),
    );
    const oldLogs = await logsGET(makeRequest(`http://localhost/api/logs/${dealId}`, { userId: users.rep.id }), { params: Promise.resolve({ dealId }) });
    const newLogs = await logsGET(makeRequest(`http://localhost/api/logs/${dealId}`, { userId: users.rep2.id }), { params: Promise.resolve({ dealId }) });
    expect(oldLogs.status).toBe(403);
    expect(newLogs.status).toBe(200);
  });
});
