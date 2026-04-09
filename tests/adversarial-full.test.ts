import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, StakeholderType } from "@prisma/client";
import { GET as getStageRoute } from "../app/api/deals/[id]/stage/route";
import { GET as getMissingRoute } from "../app/api/deals/[id]/missing-signals/route";
import { GET as getExportRoute } from "../app/api/export/route";
import { prisma } from "../lib/prisma";
import {
  approveAccount,
  assignAccount,
  createAccount,
  createDeal,
  json,
  logInteraction,
  makeRequest,
  resetDbAndSeedUsers,
  setDealLastActivity,
  uniqueName,
} from "./helpers";

describe("adversarial full-suite: gaming, integrity, abuse", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;
  let repAccountId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await json<{ id: string }>(await createAccount({ byUserId: users.admin.id, name: uniqueName("AdvAcc") }));
    repAccountId = account.id;
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    await assignAccount({ byUserId: users.admin.id, accountId: account.id, assigneeId: users.rep.id });
    repDealId = (await json<{ id: string }>(
      await createDeal({ byUserId: users.rep.id, name: uniqueName("AdvDeal"), value: 1000, accountId: account.id }),
    )).id;
  });

  it("1) fake commitment attempt blocked without prior steps", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED });
    expect(res.status).toBe(400);
  });

  it("2) direct close attempt blocked before confirmed", async () => {
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PO_RECEIVED });
    expect(res.status).toBe(400);
  });

  it("3) no movement spam does not promote stage", async () => {
    for (let i = 0; i < 6; i++) {
      await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    }
    const stageRes = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const stage = await json<{ stage: string }>(stageRes);
    expect(stage.stage).toBe("ACCESS");
  });

  it("4) conflicting signals force ACCESS via negative override", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_DROPPED });
    const stageRes = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const stage = await json<{ stage: string }>(stageRes);
    expect(stage.stage).toBe("ACCESS");
  });

  it("5) missing signals flags DM and budget when absent", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_INFLUENCER });
    const res = await getMissingRoute(makeRequest(`http://localhost/api/deals/${repDealId}/missing`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const body = await json<{ missingSignals: string[] }>(res);
    expect(body.missingSignals).toContain("Missing Decision Maker");
    expect(body.missingSignals).toContain("Missing Budget Discussion");
  });

  it("6) stale deal signal triggered after 7+ days", async () => {
    await setDealLastActivity(repDealId, 9);
    const res = await getMissingRoute(makeRequest(`http://localhost/api/deals/${repDealId}/missing`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const body = await json<{ missingSignals: string[] }>(res);
    expect(body.missingSignals).toContain("No Recent Activity (7 days)");
  });

  it("7) completed sequence reaches COMMITTED", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const body = await json<{ stage: string }>(res);
    expect(body.stage).toBe("COMMITTED");
  });

  it("8) closed requires confirmed + po", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.MET_DECISION_MAKER, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.DEAL_CONFIRMED, stakeholderType: StakeholderType.DECISION_MAKER });
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PO_RECEIVED, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const body = await json<{ stage: string }>(res);
    expect(body.stage).toBe("CLOSED");
  });

  it("9) duplicate account bypass with case/whitespace blocked", async () => {
    const name = uniqueName("DupBypass");
    const a = await createAccount({ byUserId: users.rep.id, name: ` ${name} Group ` });
    const b = await createAccount({ byUserId: users.rep2.id, name: `${name}   group` });
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
  });

  it("10) reassignment abuse changes access immediately", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId: repAccountId, assigneeId: users.rep2.id });
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("11) logging after unassignment blocked", async () => {
    await assignAccount({ byUserId: users.manager.id, accountId: repAccountId, assigneeId: users.rep2.id });
    const res = await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.FOLLOW_UP_DONE });
    expect(res.status).toBe(403);
  });

  it("12) cross-user manipulation denied on logs", async () => {
    const res = await logInteraction({ byUserId: users.rep2.id, dealId: repDealId, outcome: Outcome.NO_RESPONSE });
    expect(res.status).toBe(403);
  });

  it("13) rep export is blocked", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.rep.id }));
    expect(res.status).toBe(403);
  });

  it("14) export row contains stage and missing signals", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: users.admin.id }));
    const csv = await res.text();
    expect(csv).toContain("Missing Signals");
    expect(csv).toMatch(/ACCESS|QUALIFIED|EVALUATION|COMMITTED|CLOSED/);
  });

  it("15) manager cannot create deal on rep assigned account", async () => {
    const res = await createDeal({ byUserId: users.manager.id, name: uniqueName("MgrBypass"), value: 10, accountId: repAccountId });
    expect(res.status).toBe(403);
  });

  it("16) admin cannot create deal on rep assigned account", async () => {
    const res = await createDeal({ byUserId: users.admin.id, name: uniqueName("AdminBypass"), value: 10, accountId: repAccountId });
    expect(res.status).toBe(403);
  });

  it("17) approve/reject race leaves deterministic final status", async () => {
    const account = await json<{ id: string }>(await createAccount({ byUserId: users.rep.id, name: uniqueName("Race") }));
    await approveAccount({ byUserId: users.admin.id, accountId: account.id });
    const rejectRoute = await import("../app/api/accounts/[id]/reject/route");
    await rejectRoute.POST(makeRequest("http://localhost/api/accounts/reject", { method: "POST", userId: users.admin.id, body: {} }), { params: Promise.resolve({ id: account.id }) });
    const final = await prisma.account.findUnique({ where: { id: account.id } });
    expect(["APPROVED", "REJECTED"]).toContain(String(final?.status));
  });

  it("18) invalid user id is rejected with 401", async () => {
    const res = await getExportRoute(makeRequest("http://localhost/api/export", { userId: "totally-invalid" }));
    expect(res.status).toBe(401);
  });

  it("19) missing user header returns 401", async () => {
    const res = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`), { params: Promise.resolve({ id: repDealId }) });
    expect(res.status).toBe(401);
  });

  it("20) deal remains inaccessible to rep after reassignment away", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId: repAccountId, assigneeId: users.rep2.id });
    const res = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    expect(res.status).toBe(403);
  });

  it("21) reassigned rep gains access", async () => {
    await assignAccount({ byUserId: users.admin.id, accountId: repAccountId, assigneeId: users.rep2.id });
    const res = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep2.id }), { params: Promise.resolve({ id: repDealId }) });
    expect(res.status).toBe(200);
  });

  it("22) evaluation achieved with eval outcomes only", async () => {
    await logInteraction({ byUserId: users.rep.id, dealId: repDealId, outcome: Outcome.PROPOSAL_SHARED, stakeholderType: StakeholderType.DECISION_MAKER });
    const res = await getStageRoute(makeRequest(`http://localhost/api/deals/${repDealId}/stage`, { userId: users.rep.id }), { params: Promise.resolve({ id: repDealId }) });
    const body = await json<{ stage: string }>(res);
    expect(body.stage).toBe("EVALUATION");
  });
});
