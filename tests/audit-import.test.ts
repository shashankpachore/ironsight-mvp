import { beforeEach, describe, expect, it } from "vitest";
import { AuditAction, AuditEntityType } from "@prisma/client";
import { GET as getAuditRoute } from "../app/api/audit/route";
import { POST as createUserRoute } from "../app/api/users/route";
import { PATCH as patchUserRoute, DELETE as deleteUserRoute } from "../app/api/users/[id]/route";
import { POST as importAccountsRoute } from "../app/api/accounts/import/route";
import { json, makeRequest, resetDbAndSeedUsers } from "./helpers";
import { prisma } from "../lib/prisma";

describe("audit + account import", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    await prisma.auditLog.deleteMany();
  });

  it("creates audit rows for user create/update/delete", async () => {
    const created = await json<{ id: string }>(
      await createUserRoute(
        makeRequest("http://localhost/api/users", {
          method: "POST",
          userId: users.admin.id,
          body: {
            name: "Audit Rep",
            email: "audit.rep@ironsight.local",
            password: "test1234",
            role: "REP",
            managerId: users.manager.id,
          },
        }),
      ),
    );

    await patchUserRoute(
      makeRequest(`http://localhost/api/users/${created.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { name: "Audit Rep Updated", role: "REP" },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    await deleteUserRoute(
      makeRequest(`http://localhost/api/users/${created.id}`, {
        method: "DELETE",
        userId: users.admin.id,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    const logs = await prisma.auditLog.findMany({
      where: { entityType: AuditEntityType.USER, entityId: created.id },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.action)).toEqual([
      AuditAction.CREATE,
      AuditAction.UPDATE,
      AuditAction.DELETE,
    ]);
  });

  it("audit API is admin-only", async () => {
    const adminRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.admin.id }));
    const repRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.rep.id }));
    expect(adminRes.status).toBe(200);
    expect(repRes.status).toBe(403);
  });

  it("csv preview validates and detects duplicates", async () => {
    const csv = "School Name,State,District\nGreen School,MH,Pune\nGreen School,MH,Pune\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "schools.csv", { type: "text/csv" }));
    const req = new Request("http://localhost/api/accounts/import?mode=preview", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    const body = await json<{ validRows: number; rows: Array<{ duplicateInFile: boolean }> }>(res);
    expect(res.status).toBe(200);
    expect(body.validRows).toBe(1);
    expect(body.rows.some((r) => r.duplicateInFile)).toBe(true);
  });

  it("csv confirm imports PENDING accounts assigned to current user", async () => {
    const csv = "Partner Name,State,District\nAcme Partner,GJ,Ahmedabad\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "partners.csv", { type: "text/csv" }));
    const req = new Request("http://localhost/api/accounts/import?mode=confirm", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    expect(res.status).toBe(200);

    const account = await prisma.account.findFirst({
      where: { normalized: "acme partner" },
    });
    expect(account).toBeTruthy();
    expect(account?.status).toBe("PENDING");
    expect(account?.assignedToId).toBe(users.rep.id);
  });
});
