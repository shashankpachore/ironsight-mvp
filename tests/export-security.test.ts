import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportGET } from "../app/api/export/route";
import { createAccount, approveAccount, assignAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";

describe("export security regression", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("ExpSec") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.rep.id });
    await createDeal({ byUserId: users.rep.id, accountId: acc.id, value: 100, name: PRODUCT_OPTIONS[0] });
  });

  it("REP is blocked (403)", async () => {
    const res = await exportGET(makeRequest("http://localhost/api/export", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("MANAGER is allowed (200)", async () => {
    const res = await exportGET(makeRequest("http://localhost/api/export", { userId: users.manager.id }));
    expect(res.status).toBe(200);
  });

  it("ADMIN is allowed (200)", async () => {
    const res = await exportGET(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    expect(res.status).toBe(200);
  });

  it("no session is denied (401)", async () => {
    const res = await exportGET(makeRequest("http://localhost/api/export"));
    expect(res.status).toBe(401);
  });

  it("invalid user id is denied (401)", async () => {
    const res = await exportGET(makeRequest("http://localhost/api/export", { userId: "not-real" }));
    expect(res.status).toBe(401);
  });
});
