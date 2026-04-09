import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAccountsRoute } from "../app/api/accounts/route";
import { GET as getPendingAccountsRoute } from "../app/api/accounts/pending/route";
import { GET as getDealsRoute } from "../app/api/deals/route";
import { GET as getExportRoute } from "../app/api/export/route";
import { GET as getDealStageRoute } from "../app/api/deals/[id]/stage/route";
import { GET as getDealMissingRoute } from "../app/api/deals/[id]/missing-signals/route";
import { GET as getDealLogsRoute } from "../app/api/logs/[dealId]/route";
import { POST as approveRoute } from "../app/api/accounts/[id]/approve/route";
import { POST as assignRoute } from "../app/api/accounts/[id]/assign/route";
import { json, makeRequest, resetDbAndSeedUsers, createAccount, approveAccount, assignAccount, createDeal, uniqueName } from "./helpers";

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

  it("manager can assign account", async () => {
    const res = await assignRoute(
      makeRequest("http://localhost/api/accounts/assign", { method: "POST", userId: users.manager.id, body: { userId: users.rep2.id } }),
      { params: Promise.resolve({ id: approvedAccountId }) },
    );
    expect(res.status).toBe(200);
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

  it("manager can access both reps deals list", async () => {
    const res = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
    const body = await json<unknown[]>(res);
    expect(body.length).toBe(2);
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

  it("accounts includeAll is forbidden for rep", async () => {
    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts?includeAll=1", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });
});
