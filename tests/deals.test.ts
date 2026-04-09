import { beforeEach, describe, expect, it } from "vitest";
import { AccountStatus } from "@prisma/client";
import { GET as getDealsRoute } from "../app/api/deals/route";
import { GET as getDealByIdRoute } from "../app/api/deals/[id]/route";
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

  it("rep deal list contains only deals for accounts assigned to rep", async () => {
    const repAccount = await prepAssignedAccount(users.rep.id);
    const rep2Account = await prepAssignedAccount(users.rep2.id);
    await createDeal({ byUserId: users.rep.id, name: "Own", value: 10, accountId: repAccount });
    await createDeal({ byUserId: users.rep2.id, name: "Other", value: 11, accountId: rep2Account });
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    const rows = await json<Array<{ accountId: string }>>(res);
    expect(rows.every((d) => d.accountId === repAccount)).toBe(true);
  });

  it("manager sees all deals", async () => {
    const a1 = await prepAssignedAccount(users.rep.id);
    const a2 = await prepAssignedAccount(users.rep2.id);
    await createDeal({ byUserId: users.rep.id, name: "D1", value: 10, accountId: a1 });
    await createDeal({ byUserId: users.rep2.id, name: "D2", value: 11, accountId: a2 });
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
    const rows = await json<unknown[]>(res);
    expect(rows.length).toBe(2);
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

  it("manager can read any deal by id", async () => {
    const accountId = await prepAssignedAccount(users.rep2.id);
    const deal = await json<{ id: string }>(await createDeal({ byUserId: users.rep2.id, name: "Visible", value: 99, accountId }));
    const res = await getDealByIdRoute(
      makeRequest(`http://localhost/api/deals/${deal.id}`, { userId: users.manager.id }),
      { params: Promise.resolve({ id: deal.id }) },
    );
    expect(res.status).toBe(200);
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
});
