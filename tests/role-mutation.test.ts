import { beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { PATCH as userPATCH } from "../app/api/users/[id]/route";
import { GET as usersGET } from "../app/api/users/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

describe("role mutation behavior", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("RoleMut") }));
    accountId = acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    await createDeal({ byUserId: users.rep.id, accountId, value: 100, name: PRODUCT_OPTIONS[0] });
  });

  it("REP -> MANAGER retains existing deal ownership but cannot assign", async () => {
    const beforeDeals = await prisma.deal.findMany({ where: { ownerId: users.rep.id } });
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, { method: "PATCH", userId: users.admin.id, body: { role: UserRole.MANAGER } }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    const afterDeals = await prisma.deal.findMany({ where: { ownerId: users.rep.id } });
    expect(afterDeals.length).toBe(beforeDeals.length);

    const acc2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("PromAssign") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc2.id });
    const assign = await assignAccount({ byUserId: users.rep.id, accountId: acc2.id, assigneeId: users.rep2.id });
    expect(assign.status).toBe(403);
  });

  it("MANAGER -> REP loses user API access but retains own pipeline visibility", async () => {
    const otherMgr = await prisma.user.create({
      data: {
        name: "Other Mgr",
        email: `${uniqueName("om")}@ironsight.local`,
        password: "test1234",
        role: UserRole.MANAGER,
      },
    });
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("MgrOwn") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.manager.id });
    await createDeal({ byUserId: users.manager.id, accountId: acc.id, value: 50, name: PRODUCT_OPTIONS[0] });

    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.manager.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP, managerId: otherMgr.id },
      }),
      { params: Promise.resolve({ id: users.manager.id }) },
    );
    const usersApi = await usersGET(makeRequest("http://localhost/api/users", { userId: users.manager.id }));
    const pipeline = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    expect(usersApi.status).toBe(403);
    expect(pipeline.status).toBe(200);
  });

  it("MANAGER -> REP with null managerId returns 400", async () => {
    const patch = await userPATCH(
      makeRequest(`http://localhost/api/users/${users.manager.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP, managerId: null },
      }),
      { params: Promise.resolve({ id: users.manager.id }) },
    );
    expect(patch.status).toBe(400);
  });
});
