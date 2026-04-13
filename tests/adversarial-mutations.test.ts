import { beforeEach, describe, expect, it } from "vitest";
import { PATCH as userPATCH, DELETE as userDELETE } from "../app/api/users/[id]/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType, UserRole } from "@prisma/client";
import { defaultNextStepRequestFields } from "../lib/next-step";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

describe("adversarial mutation stress", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("AdvMut") }));
    accountId = acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    dealId = (await json<{ id: string }>(await createDeal({ byUserId: users.rep.id, accountId, value: 200, name: PRODUCT_OPTIONS[0] }))).id;
  });

  it("rapid account reassignment loops preserve single authoritative assignee", async () => {
    for (let i = 0; i < 12; i++) {
      await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: i % 2 === 0 ? users.rep.id : users.rep2.id });
    }
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect([users.rep.id, users.rep2.id]).toContain(account?.assignedToId ?? "");
  });

  it("role flipping REP<->MANAGER repeatedly does not break user record", async () => {
    for (let i = 0; i < 8; i++) {
      await userPATCH(
        makeRequest(`http://localhost/api/users/${users.rep.id}`, {
          method: "PATCH",
          userId: users.admin.id,
          body: { role: i % 2 === 0 ? UserRole.MANAGER : UserRole.REP },
        }),
        { params: Promise.resolve({ id: users.rep.id }) },
      );
    }
    const dbUser = await prisma.user.findUnique({ where: { id: users.rep.id } });
    expect([UserRole.REP, UserRole.MANAGER]).toContain(dbUser!.role);
  });

  it("logging during reassignment boundary enforces current assignee", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const ns = defaultNextStepRequestFields(Outcome.NO_RESPONSE);
    const oldRes = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.NO_RESPONSE,
          stakeholderType: StakeholderType.UNKNOWN,
          risks: [RiskCategory.NO_ACCESS_TO_DM],
          ...ns,
        },
      }),
    );
    const newRes = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep2.id,
        body: {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.NO_RESPONSE,
          stakeholderType: StakeholderType.UNKNOWN,
          risks: [RiskCategory.NO_ACCESS_TO_DM],
          ...ns,
        },
      }),
    );
    expect(oldRes.status).toBe(403);
    expect(newRes.status).toBe(201);
  });

  it("manager self-assignment shifts manager-executable pipeline surface", async () => {
    const before = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    const beforeCount = Object.values(before).reduce((s, x) => s + x.count, 0);
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.manager.id });
    const after = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    const afterCount = Object.values(after).reduce((s, x) => s + x.count, 0);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it("deleting user with dependencies remains blocked", async () => {
    const res = await userDELETE(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, { method: "DELETE", userId: users.admin.id }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    expect(res.status).toBe(409);
  });
});
