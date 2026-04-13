import { beforeEach, describe, expect, it } from "vitest";
import { GET as complianceGET } from "../app/api/activity/compliance/route";
import { makeRequest, resetDbAndSeedUsers } from "./helpers";

describe("activity compliance API", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("returns 401 without session", async () => {
    const res = await complianceGET(makeRequest("http://localhost/api/activity/compliance"));
    expect(res.status).toBe(401);
  });

  it("rep gets 403", async () => {
    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.rep.id }),
    );
    expect(res.status).toBe(403);
  });

  it("manager gets 200 and only direct-report reps", async () => {
    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string }[];
    const ids = body.map((r) => r.userId).sort();
    expect(ids).toEqual([users.rep.id]);
  });

  it("admin gets 200 and includes all reps", async () => {
    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.admin.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string }[];
    const ids = new Set(body.map((r) => r.userId));
    expect(ids.has(users.rep.id)).toBe(true);
    expect(ids.has(users.rep2.id)).toBe(true);
    expect(body.length).toBe(2);
  });
});
