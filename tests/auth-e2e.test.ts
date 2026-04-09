import { beforeEach, describe, expect, it } from "vitest";
import { GET as sessionMeGET } from "../app/api/session/me/route";
import { POST as loginPOST } from "../app/api/auth/login/route";
import { POST as logoutPOST } from "../app/api/auth/logout/route";
import { makeRequest, resetDbAndSeedUsers } from "./helpers";

describe("auth e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("login success with valid credentials", async () => {
    const res = await loginPOST(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: users.rep.email, password: "test1234" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("ironsight_user_id=");
  });

  it("login failure for wrong password", async () => {
    const res = await loginPOST(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: users.rep.email, password: "wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("login failure for invalid email", async () => {
    const res = await loginPOST(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: "ghost@ironsight.local", password: "test1234" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("session persists across request when cookie is reused", async () => {
    const loginRes = await loginPOST(
      makeRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: users.manager.email, password: "test1234" },
      }),
    );
    const setCookie = loginRes.headers.get("set-cookie") ?? "";
    const cookieValue = setCookie.split(";")[0];
    const meRes = await sessionMeGET(
      new Request("http://localhost/api/session/me", {
        headers: new Headers({ cookie: cookieValue }),
      }),
    );
    expect(meRes.status).toBe(200);
  });

  it("logout clears session cookie", async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("protected route without login returns 401", async () => {
    const res = await sessionMeGET(makeRequest("http://localhost/api/session/me"));
    expect(res.status).toBe(401);
  });

  it("session switching endpoint is deprecated", async () => {
    const route = await import("../app/api/session/switch/route");
    const res = await route.POST();
    expect(res.status).toBe(410);
  });
});
