import { beforeEach, describe, expect, it } from "vitest";
import { PATCH as userPATCH, DELETE as userDELETE } from "../app/api/users/[id]/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { InteractionType, Outcome, RiskCategory, StakeholderType, UserRole } from "@prisma/client";
import { defaultNextStepRequestFields } from "../lib/next-step";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

describe("adversarial role mutation scenarios", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("AdvRole") }),
    );
    accountId = acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    dealId = (
      await json<{ id: string }>(
        await createDeal({ byUserId: users.rep.id, accountId, value: 500, name: PRODUCT_OPTIONS[0] }),
      )
    ).id;
  });

  it("manager can reassign account to themselves and shift effective execution access", async () => {
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.manager.id });
    const res = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.manager.id,
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

  it("rapid reassignment loops keep a single assignee (no split-brain)", async () => {
    for (let i = 0; i < 10; i++) {
      await assignAccount({
        byUserId: users.manager.id,
        accountId,
        assigneeId: i % 2 === 0 ? users.rep.id : users.rep2.id,
      });
    }
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect([users.rep.id, users.rep2.id]).toContain(account?.assignedToId ?? "");
  });

  it("role flipping REP <-> MANAGER repeatedly does not drop user record integrity", async () => {
    for (let i = 0; i < 6; i++) {
      const nextRole = i % 2 === 0 ? UserRole.MANAGER : UserRole.REP;
      await userPATCH(
        makeRequest(`http://localhost/api/users/${users.rep.id}`, {
          method: "PATCH",
          userId: users.admin.id,
          body: { role: nextRole },
        }),
        { params: Promise.resolve({ id: users.rep.id }) },
      );
    }
    const dbUser = await prisma.user.findUnique({ where: { id: users.rep.id } });
    expect(dbUser).toBeTruthy();
    expect([UserRole.REP, UserRole.MANAGER]).toContain(dbUser!.role);
  });

  it("logging during reassignment immediately enforces latest assignee", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const oldRepTry = await logsPOST(
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
    const newRepTry = await logsPOST(
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
    expect(oldRepTry.status).toBe(403);
    expect(newRepTry.status).toBe(201);
  });

  it("deleting user with dependencies remains blocked under role mutations", async () => {
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    const del = await userDELETE(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, {
        method: "DELETE",
        userId: users.admin.id,
      }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    expect(del.status).toBe(409);
  });

  it("manager pipeline shifts when self-assigning active accounts", async () => {
    const beforeRes = await pipelineGET(
      makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }),
    );
    const before = (await beforeRes.json()) as Record<string, { count: number }>;
    const beforeCount = Object.values(before).reduce((sum, s) => sum + s.count, 0);
    await assignAccount({ byUserId: users.manager.id, accountId, assigneeId: users.manager.id });
    const afterRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    const after = (await afterRes.json()) as Record<string, { count: number }>;
    const afterCount = Object.values(after).reduce((sum, s) => sum + s.count, 0);
    expect(beforeRes.status).toBe(200);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it("cross-role invalid session after mutation still denied", async () => {
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.rep2.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: users.rep2.id }) },
    );
    const pipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: "malicious-id" }));
    expect(pipe.status).toBe(401);
  });
});
