import { beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { GET as usersGET, POST as usersPOST } from "../app/api/users/route";
import { PATCH as userPATCH, DELETE as userDELETE } from "../app/api/users/[id]/route";
import { json, makeRequest, resetDbAndSeedUsers } from "./helpers";
import { prismaTest as prisma } from "../lib/test-prisma";

describe("users e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("admin can create REP", async () => {
    const res = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.admin.id,
        body: {
          name: "New Rep",
          email: "newrep@ironsight.local",
          password: "pass1234",
          role: UserRole.REP,
          managerId: users.manager.id,
        },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("admin can create MANAGER", async () => {
    const res = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.admin.id,
        body: {
          name: "New Manager",
          email: "newmgr@ironsight.local",
          password: "pass1234",
          role: UserRole.MANAGER,
        },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("admin can update user", async () => {
    const createRes = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.admin.id,
        body: {
          name: "To Update",
          email: "upd@ironsight.local",
          password: "pass",
          role: UserRole.REP,
          managerId: users.manager.id,
        },
      }),
    );
    const created = await json<{ id: string }>(createRes);
    const patchRes = await userPATCH(
      makeRequest(`http://localhost/api/users/${created.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { name: "Updated Name" },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patchRes.status).toBe(200);
  });

  it("admin can delete user without dependencies", async () => {
    const createRes = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.admin.id,
        body: { name: "Delete Me", email: "deleteme@ironsight.local", password: "pass", role: UserRole.MANAGER },
      }),
    );
    const created = await json<{ id: string }>(createRes);
    const delRes = await userDELETE(
      makeRequest(`http://localhost/api/users/${created.id}`, {
        method: "DELETE",
        userId: users.admin.id,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(delRes.status).toBe(200);
  });

  it("admin cannot delete self", async () => {
    const res = await userDELETE(
      makeRequest(`http://localhost/api/users/${users.admin.id}`, {
        method: "DELETE",
        userId: users.admin.id,
      }),
      { params: Promise.resolve({ id: users.admin.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("admin cannot delete another admin", async () => {
    const otherAdmin = await prisma.user.create({
      data: { name: "Admin2", email: "admin2@ironsight.local", password: "pass", role: UserRole.ADMIN },
    });
    const res = await userDELETE(
      makeRequest(`http://localhost/api/users/${otherAdmin.id}`, {
        method: "DELETE",
        userId: users.admin.id,
      }),
      { params: Promise.resolve({ id: otherAdmin.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("cannot delete user with dependencies", async () => {
    const account = await prisma.account.create({
      data: {
        name: "Dep Co",
        normalized: "dep co",
        status: "APPROVED",
        createdById: users.rep.id,
        assignedToId: users.rep.id,
      },
    });
    await prisma.deal.create({
      data: {
        name: "CRM",
        companyName: account.name,
        value: 10,
        accountId: account.id,
        ownerId: users.rep.id,
      },
    });
    const res = await userDELETE(
      makeRequest(`http://localhost/api/users/${users.rep.id}`, { method: "DELETE", userId: users.admin.id }),
      { params: Promise.resolve({ id: users.rep.id }) },
    );
    expect(res.status).toBe(409);
  });

  it("manager cannot create users", async () => {
    const res = await usersPOST(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.manager.id,
        body: { name: "Bad", email: "bad@ironsight.local", password: "pass", role: UserRole.REP },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rep cannot access user APIs", async () => {
    const res = await usersGET(makeRequest("http://localhost/api/users", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("users API requires session", async () => {
    const res = await usersGET(makeRequest("http://localhost/api/users"));
    expect(res.status).toBe(401);
  });
});
