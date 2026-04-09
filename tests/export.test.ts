import { beforeEach, describe, expect, it } from "vitest";
import { GET as getExportRoute } from "../app/api/export/route";
import { GET as getDealsRoute } from "../app/api/deals/route";
import { Outcome, StakeholderType } from "@prisma/client";
import { createAccount, approveAccount, assignAccount, createDeal, json, logInteraction, makeRequest, resetDbAndSeedUsers, setDealLastActivity, uniqueName } from "./helpers";

function parseCsv(csv: string) {
  const lines = csv.trim().split("\n");
  return {
    header: lines[0],
    rows: lines.slice(1),
  };
}

describe("export api - role + integrity checks", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("ExportAcc") }));
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: uniqueName("ExportDeal"), value: 1000, accountId: account.id }),
    )).id;
  });

  it("admin can export csv", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("manager can export csv", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.manager.id }));
    expect(res.status).toBe(200);
  });

  it("rep cannot export", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("csv has required headers", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const text = await res.text();
    const { header } = parseCsv(text);
    expect(header).toBe("Account Name,Assigned Rep,Deal Value,Stage,Last Activity Date,Missing Signals");
  });

  it("csv row count matches deals count", async () => {
    const dealsRes = await getDealsRoute(makeRequest("http://localhost/api/deals", { userId: users.admin.id }));
    const deals = await json<unknown[]>(dealsRes);
    const exportRes = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const { rows } = parseCsv(await exportRes.text());
    expect(rows.length).toBe(deals.length);
  });

  it("csv includes stage value", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const { rows } = parseCsv(await res.text());
    expect(rows.some((r) => r.includes('"ACCESS"') || r.includes('"QUALIFIED"') || r.includes('"EVALUATION"') || r.includes('"COMMITTED"') || r.includes('"CLOSED"'))).toBe(true);
  });

  it("csv includes missing signals column content", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const { rows } = parseCsv(await res.text());
    expect(rows[0].split(",").length).toBeGreaterThanOrEqual(6);
  });

  it("csv has latest stale signal when lastActivity exceeds 7 days", async () => {
    await setDealLastActivity(repDealId, 8);
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const text = await res.text();
    expect(text).toContain("No Recent Activity (7 days)");
  });

  it("csv content-disposition has expected filename", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    expect(res.headers.get("content-disposition")).toContain("ironsight-export.csv");
  });

  it("export escapes quoted values safely", async () => {
    const account = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName('E"xport') }));
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });
    await createDeal({ byUserId: users.rep.id, name: uniqueName("EscapeDeal"), value: 333, accountId: account.id });
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const text = await res.text();
    expect(text.includes('""')).toBe(true);
  });
});
