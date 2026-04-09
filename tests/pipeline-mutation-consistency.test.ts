import { beforeEach, describe, expect, it } from "vitest";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { PATCH as userPATCH } from "../app/api/users/[id]/route";
import { UserRole } from "@prisma/client";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

function totalCount(p: Record<string, { count: number }>) {
  return Object.values(p).reduce((sum, row) => sum + row.count, 0);
}
function totalValue(p: Record<string, { value: number }>) {
  return Object.values(p).reduce((sum, row) => sum + row.value, 0);
}

describe("pipeline mutation consistency", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountA: string;
  let accountB: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const a = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeMutA") }));
    accountA = a.id;
    await approveAccount({ byUserId: users.admin.id, accountId: accountA });
    await assignAccount({ byUserId: users.admin.id, accountId: accountA, assigneeId: users.rep.id });
    await createDeal({ byUserId: users.rep.id, accountId: accountA, value: 100, name: PRODUCT_OPTIONS[0] });

    const b = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("PipeMutB") }));
    accountB = b.id;
    await approveAccount({ byUserId: users.admin.id, accountId: accountB });
    await assignAccount({ byUserId: users.admin.id, accountId: accountB, assigneeId: users.rep2.id });
    await createDeal({ byUserId: users.rep2.id, accountId: accountB, value: 300, name: PRODUCT_OPTIONS[0] });
  });

  it("admin count/value aggregation remains correct after mutations", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId: accountA, assigneeId: users.rep2.id });
    const pipe = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    const body = (await pipe.json()) as Record<string, { count: number; value: number }>;
    expect(totalCount(body)).toBe(2);
    expect(totalValue(body)).toBe(400);
  });

  it("manager reassignment updates visibility buckets", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    const mgr2 = await prisma.user.create({
      data: { name: "mgrX", email: "mgrx@ironsight.local", password: "test1234", role: "MANAGER" },
    });
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: mgr2.id } });

    const oldMgr = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    const newMgr = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: mgr2.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(oldMgr)).toBe(0);
    expect(totalCount(newMgr)).toBe(1);
  });

  it("detect owner-vs-assignee mismatch after account reassignment", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId: accountA, assigneeId: users.rep2.id });
    const repPipe = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(repPipe)).toBe(0);
  });

  it("role upgrade and downgrade immediately change pipeline scope", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    const managerBefore = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(managerBefore)).toBe(1);

    const otherMgr = await prisma.user.create({
      data: {
        name: "Other Mgr PipeMut",
        email: `pipemut-${Date.now()}@ironsight.local`,
        password: "test1234",
        role: "MANAGER",
      },
    });
    await userPATCH(
      makeRequest(`http://localhost/api/users/${users.manager.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP, managerId: otherMgr.id },
      }),
      { params: Promise.resolve({ id: users.manager.id }) },
    );
    const managerAfter = (await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id })).then((r) => r.json())) as Record<string, { count: number }>;
    expect(totalCount(managerAfter)).toBe(0);
  });
});
