import { beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { PATCH as userPATCH } from "../app/api/users/[id]/route";
import { GET as usersGET } from "../app/api/users/route";
import { GET as accountsGET } from "../app/api/accounts/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

describe("role change mutation tests", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repAccountId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("RoleBase") }),
    );
    repAccountId = account.id;
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });
    await createDeal({
      byUserId: users.rep.id,
      accountId: account.id,
      value: 100,
      name: PRODUCT_OPTIONS[0],
    });
  });

  it("REP -> MANAGER retains own accounts and deals", async () => {
    const patch = await userPATCH(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    expect(patch.status).toBe(200);

    const accountsRes = await accountsGET(makeRequest("http://localhost/api/accounts", { userId: users.rep.id }));
    const deals = await prisma.deal.findMany({ where: { ownerId: users.rep.id } });
    expect(accountsRes.status).toBe(200);
    expect(deals.length).toBeGreaterThan(0);
  });

  it("REP -> MANAGER can assign accounts", async () => {
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    const acc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("AssignByPromoted") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    const assign = await assignAccount({ byUserId: users.rep.id, accountId: acc.id, assigneeId: users.rep2.id });
    expect(assign.status).toBe(200);
  });

  it("MANAGER -> REP loses user-management visibility", async () => {
    const otherMgr = await prisma.user.create({
      data: {
        name: "Other Mgr Roles",
        email: `${uniqueName("omr")}@ironsight.local`,
        password: "test1234",
        role: UserRole.MANAGER,
      },
    });
    const demote = await userPATCH(
      makeRequest(`http://localhost/api/users/${users.manager.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP, managerId: otherMgr.id },
      }),
      { params: Promise.resolve({ id: users.manager.id }) },
    );
    expect(demote.status).toBe(200);
    const usersList = await usersGET(makeRequest("http://localhost/api/users", { userId: users.manager.id }));
    expect(usersList.status).toBe(403);
  });

  it("MANAGER -> REP retains own deals access through ownership", async () => {
    const otherMgr = await prisma.user.create({
      data: {
        name: "Other Mgr Roles2",
        email: `${uniqueName("omr2")}@ironsight.local`,
        password: "test1234",
        role: UserRole.MANAGER,
      },
    });
    const mAcc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("MgrOwn") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: mAcc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: mAcc.id, assigneeId: users.manager.id });
    await createDeal({
      byUserId: users.manager.id,
      accountId: mAcc.id,
      value: 200,
      name: PRODUCT_OPTIONS[0],
    });
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.manager.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP, managerId: otherMgr.id },
      }),
      { params: Promise.resolve({ id: users.manager.id }) },
    );
    const pipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    expect(pipe.status).toBe(200);
  });

  it("MANAGER -> REP with null managerId returns 400", async () => {
    const demote = await userPATCH(
      makeRequest(`http://localhost/api/users/${users.manager.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP, managerId: null },
      }),
      { params: Promise.resolve({ id: users.manager.id }) },
    );
    expect(demote.status).toBe(400);
  });

  it("ADMIN -> MANAGER is blocked by route policy", async () => {
    const patch = await userPATCH(
      makeRequest(`http://localhost/api/users/${users.admin.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: users.admin.id }) },
    );
    expect(patch.status).toBe(400);
  });

  it("role change does not corrupt deal ownership", async () => {
    const existingDeals = await prisma.deal.findMany({ where: { accountId: repAccountId } });
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    const after = await prisma.deal.findMany({ where: { accountId: repAccountId } });
    expect(after.length).toBe(existingDeals.length);
    expect(after[0].ownerId).toBe(existingDeals[0].ownerId);
  });
});
