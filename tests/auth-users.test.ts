import { beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { POST as loginRoute } from "../app/api/auth/login/route";
import { POST as logoutRoute } from "../app/api/auth/logout/route";
import { POST as createUserRoute, GET as getUsersRoute } from "../app/api/users/route";
import { PATCH as patchUserRoute, DELETE as deleteUserRoute } from "../app/api/users/[id]/route";
import { createAccount, approveAccount, assignAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

describe("auth + admin user management", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("login succeeds with valid credentials and sets cookie", async () => {
    const res = await loginRoute(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: users.admin.email, password: "test1234" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("ironsight_user_id");
  });

  it("login fails with invalid credentials", async () => {
    const res = await loginRoute(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: users.admin.email, password: "wrong" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe("PASSWORD_MISMATCH");
  });

  it("logout clears session cookie", async () => {
    const res = await logoutRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("ironsight_user_id=");
  });

  it("admin can create rep user", async () => {
    const res = await createUserRoute(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.admin.id,
        body: {
          name: "New Rep",
          email: "new.rep@ironsight.local",
          password: "test1234",
          role: UserRole.REP,
          managerId: users.manager.id,
        },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("manager cannot create users", async () => {
    const res = await createUserRoute(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.manager.id,
        body: {
          name: "Nope",
          email: "nope@ironsight.local",
          password: "test1234",
          role: UserRole.REP,
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("admin can patch rep user", async () => {
    const created = await json<{ id: string }>(
      await createUserRoute(
        makeRequest("http://localhost/api/users", {
          method: "POST",
          userId: users.admin.id,
          body: {
            name: "Patch Me",
            email: "patch.me@ironsight.local",
            password: "test1234",
            role: UserRole.REP,
            managerId: users.manager.id,
          },
        }),
      ),
    );
    const res = await patchUserRoute(
      makeRequest(`http://localhost/api/users/${created.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { name: "Patched Name", role: UserRole.MANAGER },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const body = await json<{ name: string; role: UserRole }>(res);
    expect(res.status).toBe(200);
    expect(body.name).toBe("Patched Name");
    expect(body.role).toBe(UserRole.MANAGER);
  });

  it("admin cannot delete current logged-in admin", async () => {
    const res = await deleteUserRoute(
      makeRequest(`http://localhost/api/users/${users.admin.id}`, {
        method: "DELETE",
        userId: users.admin.id,
      }),
      { params: Promise.resolve({ id: users.admin.id }) },
    );
    expect(res.status).toBe(400);
  });

  it(
    "delete blocked when user has dependent records",
    async () => {
      const account = await json<{ id: string }>(
        await createAccount({ byUserId: users.admin.id, name: uniqueName("DepUserAcc") }),
      );
      await approveAccount({ byUserId: users.admin.id, accountId: account.id });
      await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });
      await createDeal({
        byUserId: users.rep.id,
        name: "Geneo ONE",
        value: 1000,
        accountId: account.id,
      });

      const res = await deleteUserRoute(
        makeRequest(`http://localhost/api/users/${users.rep.id}`, {
          method: "DELETE",
          userId: users.admin.id,
        }),
        { params: Promise.resolve({ id: users.rep.id }) },
      );
      expect(res.status).toBe(409);
    },
    30_000,
  );

  it("rep cannot list users api", async () => {
    const res = await getUsersRoute(
      makeRequest("http://localhost/api/users", {
        userId: users.rep.id,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("manager can list users api", async () => {
    const res = await getUsersRoute(
      makeRequest("http://localhost/api/users", {
        userId: users.manager.id,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("creating REP without managerId returns 400", async () => {
    const res = await createUserRoute(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.admin.id,
        body: {
          name: "No Mgr Rep",
          email: "no.mgr.rep@ironsight.local",
          password: "test1234",
          role: UserRole.REP,
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe("managerId is required for REP role");
  });

  it("updating user to REP without managerId returns 400", async () => {
    const created = await json<{ id: string }>(
      await createUserRoute(
        makeRequest("http://localhost/api/users", {
          method: "POST",
          userId: users.admin.id,
          body: {
            name: "Was Manager",
            email: "was.mgr@ironsight.local",
            password: "test1234",
            role: UserRole.MANAGER,
          },
        }),
      ),
    );
    const res = await patchUserRoute(
      makeRequest(`http://localhost/api/users/${created.id}`, {
        method: "PATCH",
        userId: users.admin.id,
        body: { role: UserRole.REP },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe("managerId is required for REP role");
  });
});
