import { beforeEach, describe, expect, it } from "vitest";
import { GET as searchAccountsRoute } from "../app/api/accounts/search/route";
import { AccountStatus } from "@prisma/client";
import { prismaTest as prisma } from "../lib/test-prisma";
import {
  approveAccount,
  assignAccount,
  createAccount,
  createAccountDirect,
  json,
  makeRequest,
  resetDbAndSeedUsers,
  uniqueName,
} from "./helpers";

describe("GET /api/accounts/search", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("returns 401 without session", async () => {
    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent("ab")}`),
    );
    expect(res.status).toBe(401);
  });

  it("returns empty accounts when q is shorter than 2", async () => {
    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=a`, { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: unknown[] }>(res);
    expect(body.accounts).toEqual([]);
  });

  it("rep finds approved self-assigned account by partial name", async () => {
    const label = uniqueName("SearchPick");
    const createRes = await createAccount({ byUserId: users.admin.id, name: `${label} Academy` });
    const account = await json<{ id: string }>(createRes);
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });

    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent(label.slice(0, 8))}`, {
        userId: users.rep.id,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: Array<{ id: string; name: string }> }>(res);
    expect(body.accounts.some((a) => a.id === account.id)).toBe(true);
    expect(body.accounts.every((a) => Object.keys(a).sort().join(",") === "id,name")).toBe(true);
  });

  it("rep2 does not see rep1 assigned account", async () => {
    const label = uniqueName("Rep1Only");
    const createRes = await createAccount({ byUserId: users.admin.id, name: `${label} School` });
    const account = await json<{ id: string }>(createRes);
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });

    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent(label.slice(0, 6))}`, {
        userId: users.rep2.id,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: Array<{ id: string }> }>(res);
    expect(body.accounts.some((a) => a.id === account.id)).toBe(false);
  });

  it("excludes non-approved accounts assigned to rep", async () => {
    const label = uniqueName("PendingOnly");
    const account = await createAccountDirect({
      name: `${label} Pending`,
      normalized: `${label}-pending`.toLowerCase().replace(/\s+/g, " "),
      type: "SCHOOL",
      state: "Maharashtra",
      district: "Mumbai",
      createdById: users.admin.id,
      assignedToId: users.rep.id,
      status: AccountStatus.PENDING,
    });

    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent(label.slice(0, 6))}`, {
        userId: users.rep.id,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: Array<{ id: string }> }>(res);
    expect(body.accounts.some((a) => a.id === account.id)).toBe(false);
  });

  it("excludes approved account assigned to another user", async () => {
    const label = uniqueName("OtherAssignee");
    const createRes = await createAccount({ byUserId: users.admin.id, name: `${label} Hub` });
    const account = await json<{ id: string }>(createRes);
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep2.id });

    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent(label.slice(0, 6))}`, {
        userId: users.rep.id,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: Array<{ id: string }> }>(res);
    expect(body.accounts.some((a) => a.id === account.id)).toBe(false);
  });

  it("orders prefix matches before contains-only matches", async () => {
    const prefix = uniqueName("OrdMid");
    const containsRes = await createAccount({
      byUserId: users.admin.id,
      name: `Zebra ${prefix}contains tail`,
    });
    const containsAcc = await json<{ id: string }>(containsRes);
    await approveAccount({ byUserId: users.admin.id, accountId: containsAcc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: containsAcc.id, assigneeId: users.rep.id });

    const prefixRes = await createAccount({
      byUserId: users.admin.id,
      name: `${prefix}prefix academy`,
    });
    const prefixAcc = await json<{ id: string }>(prefixRes);
    await approveAccount({ byUserId: users.admin.id, accountId: prefixAcc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: prefixAcc.id, assigneeId: users.rep.id });

    const q = prefix.slice(0, 6);
    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent(q)}`, { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: Array<{ id: string }> }>(res);
    const idxPrefix = body.accounts.findIndex((a) => a.id === prefixAcc.id);
    const idxContains = body.accounts.findIndex((a) => a.id === containsAcc.id);
    expect(idxPrefix).toBeGreaterThanOrEqual(0);
    expect(idxContains).toBeGreaterThanOrEqual(0);
    expect(idxPrefix).toBeLessThan(idxContains);
  });

  it("finds by normalized substring", async () => {
    const token = uniqueName("normsub");
    const createRes = await createAccount({
      byUserId: users.admin.id,
      name: `Display Name ${token} X`,
    });
    const account = await json<{ id: string }>(createRes);
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });

    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row?.normalized).toContain(token.toLowerCase());

    const res = await searchAccountsRoute(
      makeRequest(`http://localhost/api/accounts/search?q=${encodeURIComponent(token)}`, {
        userId: users.rep.id,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ accounts: Array<{ id: string }> }>(res);
    expect(body.accounts.some((a) => a.id === account.id)).toBe(true);
  });
});
