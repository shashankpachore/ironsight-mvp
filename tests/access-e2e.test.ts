import { beforeEach, describe, expect, it } from "vitest";
import { GET as usersGET } from "../app/api/users/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { GET as accountsGET } from "../app/api/accounts/route";
import { GET as exportGET } from "../app/api/export/route";
import { makeRequest, resetDbAndSeedUsers } from "./helpers";

describe("access control e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("rep blocked from admin APIs", async () => {
    const res = await usersGET(makeRequest("http://localhost/api/users", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("manager blocked from admin-only APIs", async () => {
    const res = await usersGET(makeRequest("http://localhost/api/users", { userId: users.manager.id }));
    expect(res.status).toBe(403);
  });

  it("header ignored in non-test env", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    process.env.NODE_ENV = previous;
    expect(res.status).toBe(401);
  });

  it("session required for protected actions", async () => {
    const a = await accountsGET(makeRequest("http://localhost/api/accounts"));
    const p = await pipelineGET(makeRequest("http://localhost/api/pipeline"));
    const e = await exportGET(makeRequest("http://localhost/api/export"));
    expect(a.status).toBe(401);
    expect(p.status).toBe(401);
    expect(e.status).toBe(401);
  });
});
