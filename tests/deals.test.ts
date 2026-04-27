import { beforeEach, describe, expect, it } from "vitest";
import { AccountStatus, AuditAction, AuditEntityType } from "@prisma/client";
import { GET as getDealsRoute } from "../app/api/deals/route";
import { GET as getDealByIdRoute } from "../app/api/deals/[id]/route";
import { PATCH as patchDealByIdRoute } from "../app/api/deals/[id]/route";
import { prisma } from "../lib/prisma";
import { json, makeRequest, resetDbAndSeedUsers, createAccount, approveAccount, assignAccount, createDeal, uniqueName, getDeal } from "./helpers";

describe("deals api - integrity and misuse coverage", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  async function prepAssignedAccount(assigneeId = users.rep.id) {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("DealAcc") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId });
    return acc.id;
  }

  it("cannot create without accountId", async () => {
    const res = await createDeal({ byUserId: users.rep.id, name: "D1", value: 10, accountId: undefined as unknown as string });
    expect(res.status).toBe(400);
  });

  it("cannot create on unapproved account", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Unapproved") }));
    const res = await createDeal({ byUserId: users.rep.id, name: "D1", value: 10, accountId: acc.id });
    const body = await json<{ error: string }>(res);
    expect(res.status).toBe(400);
    expect(body.error).toContain("approved");
  });

  it("cannot create on approved but unassigned account", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Unassigned") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    const res = await createDeal({ byUserId: users.rep.id, name: "D1", value: 10, accountId: acc.id });
    expect(res.status).toBe(400);
  });

  it("rep can create only on assigned account", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.rep.id, name: uniqueName("RepDeal"), value: 1000, accountId });
    expect(res.status).toBe(201);
  });

  it("rep cannot create on another rep assigned account", async () => {
    const accountId = await prepAssignedAccount(users.rep2.id);
    const res = await createDeal({ byUserId: users.rep.id, name: uniqueName("DeniedRep"), value: 1000, accountId });
    expect(res.status).toBe(403);
  });

  it("manager cannot bypass assigned-user restriction", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.manager.id, name: uniqueName("MgrDenied"), value: 1000, accountId });
    expect(res.status).toBe(403);
  });

  it("admin cannot bypass assigned-user restriction", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.admin.id, name: uniqueName("AdminDenied"), value: 1000, accountId });
    expect(res.status).toBe(403);
  });

  it("deal value must be > 0", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.rep.id, name: "Zero", value: 0, accountId });
    expect(res.status).toBe(400);
  });

  it("negative value rejected", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.rep.id, name: "Negative", value: -10, accountId });
    expect(res.status).toBe(400);
  });

  it("created deal links to correct account and companyName", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.rep.id, name: uniqueName("Link"), value: 90, accountId });
    const body = await json<{ id: string }>(res);
    const dbDeal = await getDeal(body.id);
    expect(dbDeal?.accountId).toBe(accountId);
    expect(dbDeal?.companyName).toBe(dbDeal?.account.name);
  });

  it("created deal ownerId follows account assignedToId", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const res = await createDeal({ byUserId: users.rep.id, name: uniqueName("OwnerSync"), value: 120, accountId });
    const body = await json<{ id: string }>(res);
    const [dbDeal, account] = await Promise.all([
      prisma.deal.findUnique({ where: { id: body.id } }),
      prisma.account.findUnique({ where: { id: accountId } }),
    ]);
    expect(dbDeal?.ownerId).toBe(account?.assignedToId);
  });

  it("rep deal list contains only deals for accounts assigned to rep", async () => {
    const repAccount = await prepAssignedAccount(users.rep.id);
    const rep2Account = await prepAssignedAccount(users.rep2.id);
    await createDeal({ byUserId: users.rep.id, name: "Own", value: 10, accountId: repAccount });
    await createDeal({ byUserId: users.rep2.id, name: "Other", value: 11, accountId: rep2Account });
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    const rows = await json<Array<{ accountId: string }>>(res);
    expect(rows.every((d) => d.accountId === repAccount)).toBe(true);
  });

  it("manager sees only team deals", async () => {
    const a1 = await prepAssignedAccount(users.rep.id);
    const a2 = await prepAssignedAccount(users.rep2.id);
    await createDeal({ byUserId: users.rep.id, name: "D1", value: 10, accountId: a1 });
    await createDeal({ byUserId: users.rep2.id, name: "D2", value: 11, accountId: a2 });
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
    const rows = await json<unknown[]>(res);
    expect(rows.length).toBe(1);
  });

  it("rep forbidden from reading unassigned deal by id", async () => {
    const accountId = await prepAssignedAccount(users.rep2.id);
    const deal = await json<{ id: string }>(await createDeal({ byUserId: users.rep2.id, name: "Private", value: 12, accountId }));
    const res = await getDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, { userId: users.rep.id }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("manager cannot read non-team deal by id", async () => {
    const accountId = await prepAssignedAccount(users.rep2.id);
    const deal = await json<{ id: string }>(await createDeal({ byUserId: users.rep2.id, name: "Visible", value: 99, accountId }));
    const res = await getDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, { userId: users.manager.id }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("deal creation fails for non-existent account", async () => {
    const res = await createDeal({ byUserId: users.rep.id, name: "Ghost", value: 10, accountId: "acc_missing" });
    expect(res.status).toBe(404);
  });

  it("account approval status persists after deal creation", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    await createDeal({ byUserId: users.rep.id, name: "StatusPersist", value: 43, accountId });
    const deal = await prisma.deal.findFirst({ where: { accountId } });
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(deal).toBeTruthy();
    expect(account?.status).toBe(AccountStatus.APPROVED);
  });

  it("rep can patch own deal value and audit is recorded", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const deal = await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: "Editable", value: 100, accountId }),
    );

    const res = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, {
        method: "PATCH",
        userId: users.rep.id,
        body: { value: 175 },
      }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(200);
    const body = await json<{ value: number }>(res);
    expect(body.value).toBe(175);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: AuditEntityType.DEAL,
        entityId: deal.id,
        action: AuditAction.UPDATE,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.changedById).toBe(users.rep.id);
    expect(audit?.before).toEqual({ value: 100 });
    expect(audit?.after).toEqual({ value: 175 });
  });

  it("rep cannot patch another rep deal value", async () => {
    const accountId = await prepAssignedAccount(users.rep2.id);
    const deal = await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: "PrivateValue", value: 120, accountId }),
    );

    const res = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, {
        method: "PATCH",
        userId: users.rep.id,
        body: { value: 180 },
      }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("manager can patch direct-report deal value but not unrelated rep deal", async () => {
    const teamAccount = await prepAssignedAccount(users.rep.id);
    const teamDeal = await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: "TeamDeal", value: 200, accountId: teamAccount }),
    );
    const otherAccount = await prepAssignedAccount(users.rep2.id);
    const otherDeal = await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: "OtherDeal", value: 210, accountId: otherAccount }),
    );

    const allowedRes = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${teamDeal.id}`, {
        method: "PATCH",
        userId: users.manager.id,
        body: { value: 260 },
      }),
      { params: Promise.resolve({ id: teamDeal.id }) },
    );
    expect(allowedRes.status).toBe(200);

    const deniedRes = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${otherDeal.id}`, {
        method: "PATCH",
        userId: users.manager.id,
        body: { value: 260 },
      }),
      { params: Promise.resolve({ id: otherDeal.id }) },
    );
    expect(deniedRes.status).toBe(403);
  });

  it("admin can patch any deal value", async () => {
    const accountId = await prepAssignedAccount(users.rep2.id);
    const deal = await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: "AdminEdit", value: 220, accountId }),
    );
    const res = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { value: 240 },
      }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(200);
  });

  it("patch value validates required and positive number", async () => {
    const accountId = await prepAssignedAccount(users.rep.id);
    const deal = await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: "ValidateEdit", value: 130, accountId }),
    );

    const missingRes = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, {
        method: "PATCH",
        userId: users.rep.id,
        body: {},
      }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(missingRes.status).toBe(400);

    const zeroRes = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, {
        method: "PATCH",
        userId: users.rep.id,
        body: { value: 0 },
      }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(zeroRes.status).toBe(400);

    const negativeRes = await patchDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, {
        method: "PATCH",
        userId: users.rep.id,
        body: { value: -5 },
      }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(negativeRes.status).toBe(400);
  });
});
