import { AccountType, InteractionType, Outcome, StakeholderType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as weeklyReportGET } from "../app/api/reports/weekly/route";
import { previousIsoWeekRange, rangeForIsoWeek } from "../lib/reports/week";
import { prismaTest as prisma } from "../lib/test-prisma";
import { json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

type WeeklyReportBody = {
  week: string;
  rows: Array<{
    userId: string;
    userName: string;
    totalInteractions: number;
    totalDelta: number | null;
    breakdown: Record<string, { value: number; delta: number | null }>;
  }>;
};

async function createOwnedDeal(ownerId: string, name: string) {
  const account = await prisma.account.create({
    data: {
      name,
      normalized: uniqueName(name).toLowerCase(),
      type: AccountType.SCHOOL,
      state: "Maharashtra",
      district: "Mumbai City",
      createdById: ownerId,
      assignedToId: ownerId,
      status: "APPROVED",
    },
  });

  return prisma.deal.create({
    data: {
      name: "Product",
      companyName: name,
      value: 1000,
      accountId: account.id,
      ownerId,
    },
  });
}

async function createLog(params: { dealId: string; outcome: Outcome; createdAt: Date }) {
  return prisma.interactionLog.create({
    data: {
      dealId: params.dealId,
      interactionType: InteractionType.CALL,
      outcome: params.outcome,
      stakeholderType: StakeholderType.UNKNOWN,
      createdAt: params.createdAt,
    },
  });
}

describe("weekly execution report", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  const week = "2026-17";
  const range = rangeForIsoWeek(week);

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("calculates ISO week Monday through Sunday range", () => {
    const firstWeek = rangeForIsoWeek("2026-01");
    expect(firstWeek?.startOfWeek.toISOString()).toBe("2025-12-29T00:00:00.000Z");
    expect(firstWeek?.endOfWeek.toISOString()).toBe("2026-01-04T23:59:59.999Z");
    expect(rangeForIsoWeek("2026-54")).toBeNull();
  });

  it("aggregates interactions by deal owner and outcome", async () => {
    if (!range) throw new Error("test week invalid");
    const deal = await createOwnedDeal(users.rep.id, uniqueName("WeeklyAgg"));
    await createLog({ dealId: deal.id, outcome: Outcome.DEMO_DONE, createdAt: range.startOfWeek });
    await createLog({
      dealId: deal.id,
      outcome: Outcome.PROPOSAL_SHARED,
      createdAt: new Date(range.startOfWeek.getTime() + 2 * 60 * 60 * 1000),
    });
    await createLog({
      dealId: deal.id,
      outcome: Outcome.NEGOTIATION_STARTED,
      createdAt: range.nextWeekStart,
    });

    const res = await weeklyReportGET(
      makeRequest(`http://localhost/api/reports/weekly?week=${week}`, { userId: users.admin.id }),
    );
    const body = await json<WeeklyReportBody>(res);
    const row = body.rows.find((item) => item.userId === users.rep.id);

    expect(res.status).toBe(200);
    expect(row?.totalInteractions).toBe(2);
    expect(row?.totalDelta).toBeNull();
    expect(row?.breakdown.DEMO_DONE).toEqual({ value: 1, delta: null });
    expect(row?.breakdown.PROPOSAL_SHARED).toEqual({ value: 1, delta: null });
    expect(row?.breakdown.NEGOTIATION_STARTED).toEqual({ value: 0, delta: null });
  });

  it("computes week-over-week deltas against previous week", async () => {
    if (!range) throw new Error("test week invalid");
    const previousRange = previousIsoWeekRange(range);
    const deal = await createOwnedDeal(users.rep.id, uniqueName("WeeklyDelta"));
    await createLog({ dealId: deal.id, outcome: Outcome.DEMO_DONE, createdAt: range.startOfWeek });
    await createLog({ dealId: deal.id, outcome: Outcome.DEMO_DONE, createdAt: range.startOfWeek });
    await createLog({ dealId: deal.id, outcome: Outcome.PROPOSAL_SHARED, createdAt: range.startOfWeek });
    await createLog({ dealId: deal.id, outcome: Outcome.NO_RESPONSE, createdAt: range.startOfWeek });
    await createLog({ dealId: deal.id, outcome: Outcome.PROPOSAL_SHARED, createdAt: previousRange.startOfWeek });
    await createLog({ dealId: deal.id, outcome: Outcome.NEGOTIATION_STARTED, createdAt: previousRange.startOfWeek });
    await createLog({ dealId: deal.id, outcome: Outcome.NEGOTIATION_STARTED, createdAt: previousRange.startOfWeek });

    const res = await weeklyReportGET(
      makeRequest(`http://localhost/api/reports/weekly?week=${week}`, { userId: users.admin.id }),
    );
    const body = await json<WeeklyReportBody>(res);
    const row = body.rows.find((item) => item.userId === users.rep.id);

    expect(row?.totalInteractions).toBe(4);
    expect(row?.totalDelta).toBe(1);
    expect(row?.breakdown.DEMO_DONE).toEqual({ value: 2, delta: 2 });
    expect(row?.breakdown.PROPOSAL_SHARED).toEqual({ value: 1, delta: 0 });
    expect(row?.breakdown.NEGOTIATION_STARTED).toEqual({ value: 0, delta: -2 });
  });

  it("filters rows by requester role", async () => {
    if (!range) throw new Error("test week invalid");
    const previousRange = previousIsoWeekRange(range);
    const repDeal = await createOwnedDeal(users.rep.id, uniqueName("WeeklyRep"));
    const rep2Deal = await createOwnedDeal(users.rep2.id, uniqueName("WeeklyRep2"));
    await createLog({ dealId: repDeal.id, outcome: Outcome.DEMO_DONE, createdAt: range.startOfWeek });
    await createLog({ dealId: rep2Deal.id, outcome: Outcome.PROPOSAL_SHARED, createdAt: range.startOfWeek });
    await createLog({ dealId: rep2Deal.id, outcome: Outcome.PROPOSAL_SHARED, createdAt: previousRange.startOfWeek });

    const repRes = await weeklyReportGET(
      makeRequest(`http://localhost/api/reports/weekly?week=${week}`, { userId: users.rep.id }),
    );
    const repBody = await json<WeeklyReportBody>(repRes);
    expect(repBody.rows.map((row) => row.userId)).toEqual([users.rep.id]);
    expect(repBody.rows[0].totalDelta).toBeNull();

    const managerRes = await weeklyReportGET(
      makeRequest(`http://localhost/api/reports/weekly?week=${week}`, { userId: users.manager.id }),
    );
    const managerBody = await json<WeeklyReportBody>(managerRes);
    expect(managerBody.rows.map((row) => row.userId)).toEqual([users.rep.id]);
    expect(managerBody.rows[0].totalDelta).toBeNull();

    const adminRes = await weeklyReportGET(
      makeRequest(`http://localhost/api/reports/weekly?week=${week}`, { userId: users.admin.id }),
    );
    const adminBody = await json<WeeklyReportBody>(adminRes);
    expect(adminBody.rows.map((row) => row.userId).sort()).toEqual([users.rep.id, users.rep2.id].sort());
    expect(adminBody.rows.find((row) => row.userId === users.rep2.id)?.totalDelta).toBe(0);
  });

  it("returns an empty report for weeks without activity", async () => {
    const res = await weeklyReportGET(
      makeRequest("http://localhost/api/reports/weekly?week=2020-01", { userId: users.admin.id }),
    );
    const body = await json<WeeklyReportBody>(res);
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
  });
});
