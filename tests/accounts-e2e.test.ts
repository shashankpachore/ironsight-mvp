import { beforeEach, describe, expect, it } from "vitest";
import { AccountStatus } from "@prisma/client";
import { GET as accountsGET } from "../app/api/accounts/route";
import { GET as pendingGET } from "../app/api/accounts/pending/route";
import { POST as rejectPOST } from "../app/api/accounts/[id]/reject/route";
import { approveAccount, assignAccount, createAccount, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

describe("accounts e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("rep requests account -> pending", async () => {
    const res = await createAccount({ byUserId: users.rep.id, name: uniqueName("Req") });
    const body = await json<{ status: AccountStatus }>(res);
    expect(res.status).toBe(201);
    expect(body.status).toBe(AccountStatus.PENDING);
  });

  it("admin approves -> approved", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Approve") }));
    const res = await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    expect((await json<{ status: AccountStatus }>(res)).status).toBe(AccountStatus.APPROVED);
  });

  it("admin rejects -> rejected", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Reject") }));
    const res = await rejectPOST(
      makeRequest("http://localhost/api/accounts/reject", { method: "POST", userId: users.admin.id, body: {} }),
      { params: Promise.resolve({ id: acc.id }) },
    );
    expect((await json<{ status: AccountStatus }>(res)).status).toBe(AccountStatus.REJECTED);
  });

  it("duplicate account blocked with normalization", async () => {
    const p = uniqueName("Dup");
    await createAccount({ byUserId: users.rep.id, name: `${p} Labs` });
    const res = await createAccount({ byUserId: users.rep2.id, name: `  ${p}   labs ` });
    expect(res.status).toBe(409);
  });

  it("similar name allowed", async () => {
    const p = uniqueName("Similar");
    const a = await createAccount({ byUserId: users.rep.id, name: `${p} Labs` });
    const b = await createAccount({ byUserId: users.rep.id, name: `${p} Lab` });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("assign account by admin and manager works", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Assign") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    const a1 = await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.rep.id });
    const a2 = await assignAccount({ byUserId: users.manager.id, accountId: acc.id, assigneeId: users.rep2.id });
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
  });

  it("rep cannot assign", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("NoAssign") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    const res = await assignAccount({ byUserId: users.rep.id, accountId: acc.id, assigneeId: users.rep2.id });
    expect(res.status).toBe(403);
  });

  it("rep sees only assigned approved accounts", async () => {
    const a1 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Own") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a1.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a1.id, assigneeId: users.rep.id });
    const a2 = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Other") }));
    await approveAccount({ byUserId: users.admin.id, accountId: a2.id });
    await assignAccount({ byUserId: users.admin.id, accountId: a2.id, assigneeId: users.rep2.id });
    const res = await accountsGET(makeRequest("http://localhost/api/accounts", { userId: users.rep.id }));
    const rows = await json<Array<{ id: string }>>(res);
    expect(rows.map((r) => r.id)).toContain(a1.id);
    expect(rows.map((r) => r.id)).not.toContain(a2.id);
  });

  it("manager sees all by default", async () => {
    await createAccount({ byUserId: users.rep.id, name: uniqueName("MAll1") });
    await createAccount({ byUserId: users.rep2.id, name: uniqueName("MAll2") });
    const res = await accountsGET(makeRequest("http://localhost/api/accounts", { userId: users.manager.id }));
    expect((await json<unknown[]>(res)).length).toBeGreaterThanOrEqual(2);
  });

  it("pending endpoint admin only", async () => {
    await createAccount({ byUserId: users.rep.id, name: uniqueName("Pending") });
    const a = await pendingGET(makeRequest("http://localhost/api/accounts/pending", { userId: users.admin.id }));
    const m = await pendingGET(makeRequest("http://localhost/api/accounts/pending", { userId: users.manager.id }));
    expect(a.status).toBe(200);
    expect(m.status).toBe(403);
  });
});
