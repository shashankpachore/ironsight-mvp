import { beforeEach, describe, expect, it } from "vitest";
import { AuditAction, AuditEntityType } from "@prisma/client";
import { GET as getAuditRoute } from "../app/api/audit/route";
import { POST as createUserRoute } from "../app/api/users/route";
import { PATCH as patchUserRoute, DELETE as deleteUserRoute } from "../app/api/users/[id]/route";
import { POST as importAccountsRoute } from "../app/api/accounts/import/route";
import { json, makeRequest, resetDbAndSeedUsers } from "./helpers";
import { prismaTest as prisma } from "../lib/test-prisma";

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

  it("audit API allows admin and manager, blocks rep", async () => {
    const adminRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.admin.id }));
    const managerRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.manager.id }));
    const repRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.rep.id }));
    expect(adminRes.status).toBe(200);
    expect(managerRes.status).toBe(200);
    expect(repRes.status).toBe(403);
  });

  it("manager sees only own + direct-report actor logs, admin sees all", async () => {
    await prisma.auditLog.createMany({
      data: [
        {
          entityType: AuditEntityType.USER,
          entityId: `ent-${Date.now()}-manager`,
          action: AuditAction.UPDATE,
          changedById: users.manager.id,
        },
        {
          entityType: AuditEntityType.USER,
          entityId: `ent-${Date.now()}-rep`,
          action: AuditAction.UPDATE,
          changedById: users.rep.id,
        },
        {
          entityType: AuditEntityType.USER,
          entityId: `ent-${Date.now()}-other-team-rep`,
          action: AuditAction.UPDATE,
          changedById: users.rep2.id,
        },
        {
          entityType: AuditEntityType.USER,
          entityId: `ent-${Date.now()}-other-manager`,
          action: AuditAction.UPDATE,
          changedById: users.manager2.id,
        },
      ],
    });

    const managerRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.manager.id }));
    const managerRows = await json<Array<{ changedById: string }>>(managerRes);
    expect(managerRes.status).toBe(200);
    expect(managerRows.length).toBe(2);
    expect(managerRows.map((row) => row.changedById).sort()).toEqual(
      [users.manager.id, users.rep.id].sort(),
    );

    const adminRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.admin.id }));
    const adminRows = await json<Array<{ changedById: string }>>(adminRes);
    expect(adminRes.status).toBe(200);
    expect(adminRows.length).toBe(4);
    expect(adminRows.map((row) => row.changedById).sort()).toEqual(
      [users.manager.id, users.rep.id, users.rep2.id, users.manager2.id].sort(),
    );
  });

  it("csv preview validates and detects duplicates", async () => {
    const csv = "School Name,State,District\nGreen School,Maharashtra,Pune\nGreen School,Maharashtra,Pune\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "schools.csv", { type: "text/csv" }));
    const req = new Request("http://localhost/api/accounts/import?mode=preview", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    const body = await json<{ validRows: number; rows: Array<{ duplicateInFile: boolean; status: string }> }>(res);
    expect(res.status).toBe(200);
    expect(body.validRows).toBe(1);
    expect(body.rows[0].status).toBe("accepted");
    expect(body.rows.some((r) => r.duplicateInFile)).toBe(true);
  });

  it("csv confirm imports PENDING accounts assigned to current user", async () => {
    const csv = "Partner Name,State,District\nAcme Partner,Gujarat,Ahmedabad\n";
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
    expect(account?.requestedById).toBe(users.rep.id);
  });

  it("csv import stores canonical state and district names", async () => {
    const csv = "School Name,State,District\nCanonical School,maharashtra, mumbai \n";
    const formData = new FormData();
    formData.append("file", new File([csv], "canonical.csv", { type: "text/csv" }));
    formData.append("approvedCorrections", JSON.stringify([2]));
    const req = new Request("http://localhost/api/accounts/import?mode=confirm", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    const body = await json<{ successCount: number; failedRows: unknown[] }>(res);
    expect(res.status).toBe(200);
    expect(body.successCount).toBe(1);
    expect(body.failedRows).toEqual([]);

    const account = await prisma.account.findFirst({ where: { normalized: "canonical school" } });
    expect(account?.state).toBe("Maharashtra");
    expect(account?.district).toBe("Mumbai City");
  });

  it("csv import applies explicit state and district aliases", async () => {
    const csv = "School Name,State,District\nAlias School,KA,bangalore\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "aliases.csv", { type: "text/csv" }));
    formData.append("approvedCorrections", JSON.stringify([2]));
    const req = new Request("http://localhost/api/accounts/import?mode=confirm", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    expect(res.status).toBe(200);

    const account = await prisma.account.findFirst({ where: { normalized: "alias school" } });
    expect(account?.state).toBe("Karnataka");
    expect(account?.district).toBe("Bengaluru");
  });

  it("csv preview suggests high-confidence typo corrections without importing silently", async () => {
    const csv = "School Name,State,District\nTypo School,Maharashtr,Pune\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "typo.csv", { type: "text/csv" }));
    const previewReq = new Request("http://localhost/api/accounts/import?mode=preview", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const previewRes = await importAccountsRoute(previewReq);
    const preview = await json<{
      successCount: number;
      rows: Array<{
        status: string;
        confidence: string;
        input: { state: string; district: string };
        corrected: { state: string; district: string };
      }>;
    }>(previewRes);
    expect(preview.successCount).toBe(0);
    expect(preview.rows[0]).toMatchObject({
      status: "corrected",
      confidence: "high",
      input: { state: "Maharashtr", district: "Pune" },
      corrected: { state: "Maharashtra", district: "Pune" },
    });

    const confirmFormData = new FormData();
    confirmFormData.append("file", new File([csv], "typo.csv", { type: "text/csv" }));
    const confirmReq = new Request("http://localhost/api/accounts/import?mode=confirm", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: confirmFormData,
    });
    const confirmRes = await importAccountsRoute(confirmReq);
    const confirm = await json<{ successCount: number; failedRows: Array<{ row: number; error: string }> }>(
      confirmRes,
    );
    expect(confirm.successCount).toBe(0);
    expect(confirm.failedRows).toEqual([{ row: 2, error: "Correction not approved" }]);
  });

  it("csv preview marks ambiguous district matches as needs_review", async () => {
    const csv = "School Name,State,District\nAmbiguous School,Haryana,bad\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "ambiguous.csv", { type: "text/csv" }));
    const req = new Request("http://localhost/api/accounts/import?mode=preview", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    const body = await json<{
      rows: Array<{ status: string; confidence: string; suggestions: string[] }>;
    }>(res);
    expect(res.status).toBe(200);
    expect(body.rows[0].status).toBe("needs_review");
    expect(body.rows[0].confidence).toBe("medium");
    expect(body.rows[0].suggestions).toEqual(expect.arrayContaining(["Faridabad", "Fatehabad"]));
  });

  it("csv import rejects district outside selected state without blocking valid rows", async () => {
    const csv = [
      "School Name,State,District",
      "Good School,Haryana,Gurgaon",
      "Wrong State School,Punjab,Gurgaon",
      "Bad State School,Atlantis,Gurgaon",
    ].join("\n");
    const formData = new FormData();
    formData.append("file", new File([csv], "mixed.csv", { type: "text/csv" }));
    const req = new Request("http://localhost/api/accounts/import?mode=confirm", {
      method: "POST",
      headers: { "x-user-id": users.rep.id },
      body: formData,
    });
    const res = await importAccountsRoute(req);
    const body = await json<{ successCount: number; failedRows: Array<{ row: number; error: string }> }>(res);
    expect(res.status).toBe(200);
    expect(body.successCount).toBe(1);
    expect(body.failedRows).toEqual([
      { row: 3, error: "District does not belong to selected state" },
      { row: 4, error: "State not found" },
    ]);

    const created = await prisma.account.findMany({
      where: { normalized: { in: ["good school", "wrong state school", "bad state school"] } },
      select: { normalized: true },
    });
    expect(created.map((account) => account.normalized)).toEqual(["good school"]);
  });
});
