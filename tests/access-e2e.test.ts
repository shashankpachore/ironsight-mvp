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

  it("rep blocked from users list API", async () => {
    const res = await usersGET(makeRequest("http://localhost/api/users", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("manager can list users", async () => {
    const res = await usersGET(makeRequest("http://localhost/api/users", { userId: users.manager.id }));
    expect(res.status).toBe(200);
  });

  it("header ignored when TEST_MODE is disabled", async () => {
    const previous = process.env.TEST_MODE;
    process.env.TEST_MODE = "false";
    const res = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
    process.env.TEST_MODE = previous;
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
