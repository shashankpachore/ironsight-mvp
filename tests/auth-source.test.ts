import { beforeEach, describe, expect, it } from "vitest";
import { getCurrentUser } from "../lib/auth";
import { resetDbAndSeedUsers } from "./helpers";

describe("auth source-of-truth", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    process.env.NODE_ENV = originalEnv;
  });

  it("uses x-user-id in test environment", async () => {
    process.env.NODE_ENV = "test";
    const request = new Request("http://localhost/api/deals", {
      headers: { "x-user-id": users.rep.id },
    });
    const user = await getCurrentUser(request);
    expect(user?.id).toBe(users.rep.id);
  });

  it("ignores x-user-id in non-test environment", async () => {
    process.env.NODE_ENV = "production";
    const request = new Request("http://localhost/api/deals", {
      headers: { "x-user-id": users.rep.id },
    });
    const user = await getCurrentUser(request);
    expect(user).toBeNull();
  });

  it("requires session cookie in non-test environment", async () => {
    process.env.NODE_ENV = "production";
    const request = new Request("http://localhost/api/deals", {
      headers: { cookie: `ironsight_user_id=${users.manager.id}` },
    });
    const user = await getCurrentUser(request);
    expect(user?.id).toBe(users.manager.id);
  });
});
