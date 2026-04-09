import { beforeEach, describe, expect, it } from "vitest";
import { GET as dealGET } from "../app/api/deals/[id]/route";
import { POST as dealsPOST } from "../app/api/deals/route";
import { createAccount, approveAccount, assignAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";

describe("deals e2e", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("cannot create without account", async () => {
    const res = await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 10, accountId: "no_account" });
    expect(res.status).toBe(404);
  });

  it("cannot use unapproved account", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Unapproved") }));
    const res = await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 10, accountId: acc.id });
    expect(res.status).toBe(400);
  });

  it("cannot use unassigned account", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Unassigned") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    const res = await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 10, accountId: acc.id });
    expect(res.status).toBe(400);
  });

  it("rep can create only assigned", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("Assigned") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.rep.id });
    const ok = await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 10, accountId: acc.id });
    const denied = await createDeal({ byUserId: users.rep2.id, name: PRODUCT_OPTIONS[0], value: 10, accountId: acc.id });
    expect(ok.status).toBe(201);
    expect(denied.status).toBe(403);
  });

  it("product selection required", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("ProductReq") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.rep.id });
    const res = await dealsPOST(
      makeRequest("http://localhost/api/deals", {
        method: "POST",
        userId: users.rep.id,
        body: { name: "NOT_A_PRODUCT", value: 10, accountId: acc.id },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("deal name auto-generated behavior check", async () => {
    const acc = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("AutoName") }));
    await approveAccount({ byUserId: users.admin.id, accountId: acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: acc.id, assigneeId: users.rep.id });
    const res = await createDeal({ byUserId: users.rep.id, name: PRODUCT_OPTIONS[0], value: 10, accountId: acc.id });
    const body = await json<{ id: string; name: string }>(res);
    const detail = await dealGET(makeRequest(`http://localhost/api/deals/${body.id}`, { userId: users.rep.id }), { params: Promise.resolve({ id: body.id }) });
    const deal = await json<{ name: string }>(detail);
    expect(deal.name).toBe(PRODUCT_OPTIONS[0]);
  });
});
