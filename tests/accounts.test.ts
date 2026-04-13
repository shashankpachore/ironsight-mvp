import { beforeEach, describe, expect, it } from "vitest";
import { AccountStatus } from "@prisma/client";
import { GET as getAccountsRoute } from "../app/api/accounts/route";
import { GET as getPendingRoute } from "../app/api/accounts/pending/route";
import { POST as approveAccountRoute } from "../app/api/accounts/[id]/approve/route";
import { POST as rejectAccountRoute } from "../app/api/accounts/[id]/reject/route";
import { POST as requestAccountRoute } from "../app/api/accounts/request/route";
import { json, createAccount, approveAccount, assignAccount, makeRequest, resetDbAndSeedUsers, uniqueName, getAccount } from "./helpers";

describe("accounts api - adversarial + permissions", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("request account creates PENDING status", async () => {
    const res = await createAccount({ byUserId: users.rep.id, name: uniqueName("Acme") });
    const body = await json<{ status: AccountStatus; state: string; district: string; type: string }>(res);
    expect(res.status).toBe(201);
    expect(body.status).toBe(AccountStatus.PENDING);
    expect(body.state).toBe("Maharashtra");
    expect(body.district).toBe("Mumbai");
    expect(body.type).toBe("SCHOOL");
  });

  it("request rejects missing type", async () => {
    const res = await requestAccountRoute(
      makeRequest("http://localhost/api/accounts/request", {
        method: "POST",
        userId: users.rep.id,
        body: { name: uniqueName("NoType"), district: "D", state: "Maharashtra" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("request rejects invalid state", async () => {
    const res = await requestAccountRoute(
      makeRequest("http://localhost/api/accounts/request", {
        method: "POST",
        userId: users.rep.id,
        body: {
          type: "SCHOOL",
          name: uniqueName("BadState"),
          district: "D",
          state: "NotARealState",
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("admin can approve account", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Approve") }));
    const res = await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const body = await json<{ status: AccountStatus }>(res);
    expect(res.status).toBe(200);
    expect(body.status).toBe(AccountStatus.APPROVED);
  });

  it("admin can reject account", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Reject") }));
    const res = await rejectAccountRoute(
      makeRequest("http://localhost/api/accounts/reject", { method: "POST", userId: users.admin.id, body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const body = await json<{ status: AccountStatus }>(res);
    expect(res.status).toBe(200);
    expect(body.status).toBe(AccountStatus.REJECTED);
  });

  it("duplicate normalized name is rejected", async () => {
    const a = uniqueName("Globex");
    await createAccount({ byUserId: users.rep.id, name: `  ${a}   Health  ` });
    const res = await createAccount({ byUserId: users.rep2.id, name: `${a} health` });
    expect(res.status).toBe(409);
  });

  it("similar non-normalized names are allowed", async () => {
    const base = uniqueName("Northwind");
    const first = await createAccount({ byUserId: users.rep.id, name: `${base} Labs` });
    const second = await createAccount({ byUserId: users.rep.id, name: `${base} Lab` });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("rep cannot approve", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NoApproveRep") }));
    const res = await approveAccount({ byUserId: users.rep.id, accountId: created.id });
    expect(res.status).toBe(403);
  });

  it("manager cannot approve", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NoApproveManager") }));
    const res = await approveAccount({ byUserId: users.manager.id, accountId: created.id });
    expect(res.status).toBe(403);
  });

  it("rep cannot reject", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NoRejectRep") }));
    const res = await rejectAccountRoute(
      makeRequest("http://localhost/api/accounts/reject", { method: "POST", userId: users.rep.id, body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("manager cannot reject", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NoRejectManager") }));
    const res = await rejectAccountRoute(
      makeRequest("http://localhost/api/accounts/reject", { method: "POST", userId: users.manager.id, body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("assign only if approved", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("AssignGuard") }));
    const res = await assignAccount({ byUserId: users.admin.id, accountId: created.id, assigneeId: users.rep.id });
    expect(res.status).toBe(400);
  });

  it("admin can assign approved account", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("AssignAdmin") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const res = await assignAccount({ byUserId: users.admin.id, accountId: created.id, assigneeId: users.rep2.id });
    const body = await json<{ assignedToId: string | null }>(res);
    expect(res.status).toBe(200);
    expect(body.assignedToId).toBe(users.rep2.id);
  });

  it("manager can assign approved account", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("AssignMgr") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const res = await assignAccount({ byUserId: users.manager.id, accountId: created.id, assigneeId: users.rep2.id });
    expect(res.status).toBe(200);
  });

  it("rep cannot assign account", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("AssignRepDenied") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const res = await assignAccount({ byUserId: users.rep.id, accountId: created.id, assigneeId: users.rep2.id });
    expect(res.status).toBe(403);
  });

  it("assign fails for unknown assignee", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("UnknownAssignee") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const res = await assignAccount({ byUserId: users.admin.id, accountId: created.id, assigneeId: "no-user" });
    expect(res.status).toBe(404);
  });

  it("rep sees only assigned accounts, not pending requests or other reps' assignments", async () => {
    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("RepViewYes") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    const a2 = await json<{ id: string }>(
      await createAccount({ byUserId: users.rep2.id, name: uniqueName("RepViewNo") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });
    const a3 = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("RepPendingOwn") }));

    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts", { userId: users.rep.id }));
    const list = await json<Array<{ id: string }>>(res);
    expect(res.status).toBe(200);
    expect(list.map((x) => x.id)).toContain(a1.id);
    expect(list.map((x) => x.id)).not.toContain(a3.id);
    expect(list.map((x) => x.id)).not.toContain(a2.id);
  });

  it("manager includeAll=1 sees only own-team assigned accounts", async () => {
    const a1 = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("MgrAll1") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    const a2 = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("MgrAll2") }),
    );
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });

    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts?includeAll=1", { userId: users.manager.id }));
    const list = await json<Array<{ id: string }>>(res);
    expect(res.status).toBe(200);
    expect(list.map((x) => x.id)).toContain(a1.id);
    expect(list.map((x) => x.id)).not.toContain(a2.id);
  });

  it("admin includeAll=1 sees all accounts", async () => {
    await createAccount({ byUserId: users.rep.id, name: uniqueName("AdminAll1") });
    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts?includeAll=1", { userId: users.admin.id }));
    const list = await json<Array<{ id: string }>>(res);
    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("rep includeAll=1 is forbidden", async () => {
    await createAccount({ byUserId: users.rep.id, name: uniqueName("RepIncludeAllDenied") });
    const res = await getAccountsRoute(makeRequest("http://localhost/api/accounts?includeAll=1", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("pending accounts visible only to admin", async () => {
    await createAccount({ byUserId: users.rep.id, name: uniqueName("PendingOnlyAdmin") });
    const adminRes = await getPendingRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.admin.id }));
    const managerRes = await getPendingRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.manager.id }));
    const repRes = await getPendingRoute(makeRequest("http://localhost/api/accounts/pending", { userId: users.rep.id }));
    expect(adminRes.status).toBe(200);
    expect(managerRes.status).toBe(403);
    expect(repRes.status).toBe(403);
  });

  it("approve endpoint rejects invalid user header with 401", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("HeaderFallback") }));
    const res = await approveAccountRoute(
      makeRequest("http://localhost/api/accounts/approve", { method: "POST", userId: "fake-user", body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(401);
  });

  it("approve and reject require session", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NoSessionApproval") }));
    const approveRes = await approveAccountRoute(
      makeRequest("http://localhost/api/accounts/approve", { method: "POST", body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const rejectRes = await rejectAccountRoute(
      makeRequest("http://localhost/api/accounts/reject", { method: "POST", body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(approveRes.status).toBe(401);
    expect(rejectRes.status).toBe(401);
  });

  it("assign updates persisted assignee linkage", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("PersistAssign") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    await assignAccount({ byUserId: users.manager.id, accountId: created.id, assigneeId: users.rep2.id });
    const db = await getAccount(created.id);
    expect(db?.assignedToId).toBe(users.rep2.id);
  });

  it("second approval keeps account approved", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("IdempotentApprove") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const second = await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const body = await json<{ status: AccountStatus }>(second);
    expect(second.status).toBe(200);
    expect(body.status).toBe(AccountStatus.APPROVED);
  });

  it("reject after approval moves status to rejected", async () => {
    const created = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("RejectAfterApprove") }));
    await approveAccount({ byUserId: users.admin.id, accountId: created.id });
    const res = await rejectAccountRoute(
      makeRequest("http://localhost/api/accounts/reject", { method: "POST", userId: users.admin.id, body: {} }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const body = await json<{ status: AccountStatus }>(res);
    expect(body.status).toBe(AccountStatus.REJECTED);
  });
});
