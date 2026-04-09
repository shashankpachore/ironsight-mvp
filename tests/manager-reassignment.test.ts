import { beforeEach, describe, expect, it } from "vitest";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prisma } from "../lib/prisma";

function totalCount(p: Record<string, { count: number }>) {
  return Object.values(p).reduce((sum, row) => sum + row.count, 0);
}

describe("manager reassignment impact", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("MgrR1") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    await createDeal({ byUserId: users.rep.id, accountId: a1.id, value: 100, name: PRODUCT_OPTIONS[0] });
  });

  it("old manager loses visibility after managerId changes", async () => {
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id } });
    const mgr2 = await prisma.user.create({
      data: { name: "M2", email: "m2@ironsight.local", password: "test1234", role: "MANAGER" },
    });
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: mgr2.id } });
    const old = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.manager.id }));
    const oldBody = (await old.json()) as Record<string, { count: number }>;
    expect(totalCount(oldBody)).toBe(0);
  });

  it("new manager gains visibility after managerId changes", async () => {
    const mgr2 = await prisma.user.create({
      data: { name: "M3", email: "m3@ironsight.local", password: "test1234", role: "MANAGER" },
    });
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: mgr2.id } });
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: mgr2.id }));
    const body = (await res.json()) as Record<string, { count: number }>;
    expect(totalCount(body)).toBe(1);
  });

  it("manager reassignment does not duplicate deals", async () => {
    const before = await prisma.deal.count();
    const mgr2 = await prisma.user.create({
      data: { name: "M4", email: "m4@ironsight.local", password: "test1234", role: "MANAGER" },
    });
    await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: mgr2.id } });
    const after = await prisma.deal.count();
    expect(after).toBe(before);
  });
});
