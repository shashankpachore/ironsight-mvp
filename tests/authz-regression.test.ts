import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { requireRole } from "../lib/authz";
import { GET as exportGET } from "../app/api/export/route";
import { GET as usersGET, POST as usersPOST } from "../app/api/users/route";
import { GET as pendingGET } from "../app/api/accounts/pending/route";
import { POST as approvePOST } from "../app/api/accounts/[id]/approve/route";
import { POST as rejectPOST } from "../app/api/accounts/[id]/reject/route";
import { createAccount, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

describe("authz regression coverage", () => {
  it("requireRole: no user -> 401", async () => {
    const res = requireRole(null, [UserRole.ADMIN])!;
    expect(res.status).toBe(401);
  });

  it("requireRole: disallowed role -> 403", async () => {
    const res = requireRole({ role: UserRole.REP }, [UserRole.ADMIN])!;
    expect(res.status).toBe(403);
  });

  it("requireRole: allowed role -> pass", () => {
    const res = requireRole({ role: UserRole.ADMIN }, [UserRole.ADMIN, UserRole.MANAGER]);
    expect(res).toBeNull();
  });

  it("critical routes return 401 without session", async () => {
    const users = await usersGET(makeRequest("http://localhost/api/users"));
    const exportRes = await exportGET(makeRequest("http://localhost/api/export"));
    const pending = await pendingGET(makeRequest("http://localhost/api/accounts/pending"));
    expect(users.status).toBe(401);
    expect(exportRes.status).toBe(401);
    expect(pending.status).toBe(401);
  });

  it("approve/reject return 401 without session", async () => {
    const seeded = await resetDbAndSeedUsers();
    const created = await json<{ id: string }>(
      await createAccount({ byUserId: seeded.rep.id, name: uniqueName("NoSess") }),
    );
    const approve = await approvePOST(makeRequest("http://localhost/api/accounts/approve", { method: "POST", body: {} }), { params: Promise.resolve({ id: created.id }) });
    const reject = await rejectPOST(makeRequest("http://localhost/api/accounts/reject", { method: "POST", body: {} }), { params: Promise.resolve({ id: created.id }) });
    expect(approve.status).toBe(401);
    expect(reject.status).toBe(401);
  });

  it("users POST is admin-only", async () => {
    const seeded = await resetDbAndSeedUsers();
    const bad = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: seeded.manager.id,
        body: { name: "x", email: "x@ironsight.local", password: "x", role: UserRole.REP },
      }),
    );
    const ok = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: seeded.admin.id,
        body: {
          name: "ok",
          email: "ok@ironsight.local",
          password: "x",
          role: UserRole.REP,
          managerId: seeded.manager.id,
        },
      }),
    );
    expect(bad.status).toBe(403);
    expect(ok.status).toBe(201);
  });
});
