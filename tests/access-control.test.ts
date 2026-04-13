import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAccountsRoute } from "../app/api/accounts/route";
import { GET as getPendingAccountsRoute } from "../app/api/accounts/pending/route";
import { GET as getDealsRoute } from "../app/api/deals/route";
import { GET as getExportRoute } from "../app/api/export/route";
import { GET as getDealStageRoute } from "../app/api/deals/[id]/stage/route";
import { GET as getDealMissingRoute } from "../app/api/deals/[id]/missing-signals/route";
import { GET as getDealLogsRoute } from "../app/api/logs/[dealId]/route";
import { POST as approveRoute } from "../app/api/accounts/[id]/approve/route";
import { POST as assignRoute } from "../app/api/accounts/[id]/assign/route";
import { SESSION_COOKIE_NAME } from "../lib/auth";
import { json, makeRequest, resetDbAndSeedUsers, createAccount, approveAccount, assignAccount, createDeal, uniqueName } from "./helpers";

const pageTestCookie = vi.hoisted(() => {
  let userId: string | undefined;
  return {
    setSessionUserId(id: string | undefined) {
      userId = id;
    },
    getCookies: async () => ({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME && userId ? { value: userId } : undefined,
    }),
  };
});

vi.mock("next/headers", () => ({
  cookies: () => pageTestCookie.getCookies(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

describe("access control - critical permission boundaries", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let rep2DealId: string;
  let approvedAccountId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();

    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("AclA1") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    approvedAccountId = a1.id;
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: uniqueName("AclD1"), value: 100, accountId: a1.id }),
    )).id;

    const a2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("AclA2") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });
    rep2DealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep2.id, name: uniqueName("AclD2"), value: 200, accountId: a2.id }),
    )).id;
  });

  it("rep cannot approve account", async () => {
    const p = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NeedApprove") }));
    const res = await approveRoute(makeRequest("http://localhost/api/accounts/approve", { method: "POST", userId: users.rep.id, body: {} }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(403);
  });

  it("manager cannot approve account", async () => {
    const p = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NeedApproveMgr") }));
    const res = await approveRoute(makeRequest("http://localhost/api/accounts/approve", { method: "POST", userId: users.manager.id, body: {} }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(403);
  });

  it("admin can approve account", async () => {
    const p = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NeedApproveAdmin") }));
    const res = await approveRoute(makeRequest("http://localhost/api/accounts/approve", { method: "POST", userId: users.admin.id, body: {} }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
  });

  it("rep cannot assign account", async () => {
    const res = await assignRoute(
      makeRequest("http://localhost/api/accounts/assign", { method: "POST", userId: users.rep.id, body: { userId: users.rep2.id } }),
      { params: Promise.resolve({ id: approvedAccountId }) },
    );
    expect(res.status).toBe(403);
  });

  it("manager cannot assign account", async () => {
    const res = await assignRoute(
      makeRequest("http://localhost/api/accounts/assign", { method: "POST", userId: users.manager.id, body: { userId: users.rep2.id } }),
      { params: Promise.resolve({ id: approvedAccountId }) },
    );
    expect(res.status).toBe(403);
  });

  it("admin can assign account", async () => {
    const res = await assignRoute(
      makeRequest("http://localhost/api/accounts/assign", { method: "POST", userId: users.admin.id, body: { userId: users.rep.id } }),
      { params: Promise.resolve({ id: approvedAccountId }) },
    );
    expect(res.status).toBe(200);
  });

  it("rep cannot export", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("manager can export", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.manager.id }));
    expect(res.status).toBe(200);
  });

  it("admin can export", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    expect(res.status).toBe(200);
  });

  it("rep cannot access unassigned deal stage", async () => {
    const res = await getDealStageRoute(makeRequest(`http://localhost/api/deals/${rep2DealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: rep2DealId }) });
    expect(res.status).toBe(403);
  });

  it("rep cannot access unassigned missing-signals", async () => {
    const res = await getDealMissingRoute(makeRequest(`http://localhost/api/deals/${rep2DealId}/missing-signals`, { userId: users.rep.id }), { params: Promise.resolve({ id: rep2DealId }) });
    expect(res.status).toBe(403);
  });

  it("rep cannot access unassigned logs", async () => {
    const res = await getDealLogsRoute(makeRequest(`http://localhost/api/logs/${rep2DealId}`, { userId: users.rep.id }), { params: Promise.resolve({ dealId: rep2DealId }) });
    expect(res.status).toBe(403);
  });

  it("rep can access assigned stage", async () => {
    const res = await getDealStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    expect(res.status).toBe(200);
  });

  it("manager sees own team deals list only", async () => {
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
    const body = await json<Array<{ id: string }>>(res);
    expect(body.map((d) => d.id)).toContain(repDealId);
    expect(body.map((d) => d.id)).not.toContain(rep2DealId);
  });

  it("rep sees restricted deals list", async () => {
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    const body = await json<Array<{ id: string }>>(res);
    expect(body.map((d) => d.id)).toContain(repDealId);
    expect(body.map((d) => d.id)).not.toContain(rep2DealId);
  });

  it("missing x-user-id returns 401", async () => {
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals"));
    expect(res.status).toBe(401);
  });

  it("forged x-user-id of admin grants admin pending access (vulnerability probe)", async () => {
    const res = await getPendingAccountsRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.admin.id }));
    expect(res.status).toBe(200);
  });

  it("invalid x-user-id returns 401", async () => {
    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts", { userId: "invalid-user-id" }));
    expect(res.status).toBe(401);
  });

  it("pending accounts endpoint denies rep", async () => {
    const res = await getPendingAccountsRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("pending accounts endpoint denies manager", async () => {
    const res = await getPendingAccountsRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.manager.id }));
    expect(res.status).toBe(403);
  });

  it("pending accounts endpoint allows admin", async () => {
    const res = await getPendingAccountsRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.admin.id }));
    expect(res.status).toBe(200);
  });

  it("critical admin-only routes require session and return 401", async () => {
    const pendingRes = await getPendingAccountsRoute(makeRequest("http://localhost/api/accounts/pending"));
    const usersRoute = await import("../app/api/users/route");
    const usersRes = await usersRoute.GET(makeRequest("http://localhost/api/users"));
    expect(pendingRes.status).toBe(401);
    expect(usersRes.status).toBe(401);
  });

  it("rep gets 403 on GET /api/users", async () => {
    const { GET: getUsersRoute } = await import("../app/api/users/route");
    const res = await getUsersRoute(makeRequest("http://localhost/api/users", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("rep gets 403 on GET /api/audit", async () => {
    const { GET: getAuditRoute } = await import("../app/api/audit/route");
    const res = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("manager can GET /api/users (200)", async () => {
    const { GET: getUsersRoute } = await import("../app/api/users/route");
    const res = await getUsersRoute(makeRequest("http://localhost/api/users", { userId: users.manager.id }));
    expect(res.status).toBe(200);
  });

  it("manager can GET /api/audit (200)", async () => {
    const { GET: getAuditRoute } = await import("../app/api/audit/route");
    const res = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.manager.id }));
    expect(res.status).toBe(200);
  });

  it("admin can GET /api/users and /api/audit (200)", async () => {
    const { GET: getUsersRoute } = await import("../app/api/users/route");
    const { GET: getAuditRoute } = await import("../app/api/audit/route");
    const usersRes = await getUsersRoute(makeRequest("http://localhost/api/users", { userId: users.admin.id }));
    const auditRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.admin.id }));
    expect(usersRes.status).toBe(200);
    expect(auditRes.status).toBe(200);
  });

  it("manager cannot perform admin-only POST /api/users", async () => {
    const { POST: postUsersRoute } = await import("../app/api/users/route");
    const res = await postUsersRoute(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.manager.id,
        body: {
          name: "New Rep",
          email: "newrep@ironsight.local",
          password: "test1234",
          role: "REP",
          managerId: users.manager.id,
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("accounts includeAll is forbidden for rep", async () => {
    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts?includeAll=1", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });
});

describe("access control - admin section pages (REP redirect)", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("REP /users redirects to home", async () => {
    pageTestCookie.setSessionUserId(users.rep.id);
    const { default: UsersPage } = await import("../app/users/page");
    await expect(UsersPage()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("REP /audit redirects to home", async () => {
    pageTestCookie.setSessionUserId(users.rep.id);
    const { default: AuditPage } = await import("../app/audit/page");
    await expect(AuditPage()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("MANAGER /users does not redirect", async () => {
    pageTestCookie.setSessionUserId(users.manager.id);
    const { default: UsersPage } = await import("../app/users/page");
    const el = await UsersPage();
    expect(el).toBeTruthy();
  });
});
