import { AccountStatus, InteractionType, Outcome, StakeholderType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getTodayRoute } from "../app/api/today/route";
import { formatYmdInIST, addDaysYmd, istYmdToUtcStart } from "../lib/ist-time";
import { prismaTest as prisma } from "../lib/test-prisma";
import { resetDbAndSeedUsers, makeRequest } from "./helpers";

const BASE_NOW = new Date("2026-01-10T10:00:00.000Z");

function istAnchors(now: Date) {
  const todayYmd = formatYmdInIST(now);
  const todayStart = istYmdToUtcStart(todayYmd);
  const todayMinusTwoStart = istYmdToUtcStart(addDaysYmd(todayYmd, -2));
  const todayMinusOneStart = istYmdToUtcStart(addDaysYmd(todayYmd, -1));
  return { todayYmd, todayStart, todayMinusTwoStart, todayMinusOneStart };
}

const DAY_MS = 86_400_000;
function atIstTime(ymd: string, hour: number): Date {
  // istYmdToUtcStart gives IST midnight in UTC; adding hour keeps us on the intended IST day.
  return new Date(istYmdToUtcStart(ymd).getTime() + hour * 3_600_000);
}

async function createAssignedDeal(params: {
  adminId: string;
  ownerId: string;
  nextStepDate: Date;
  lastActivityAt: Date;
  label: string;
  includeLatestLog?: { createdAt: Date };
}) {
  const account = await prisma.account.create({
    data: {
      name: `Today-${params.label}`,
      normalized: `today-${params.label}`.toLowerCase(),
      createdById: params.adminId,
      assignedToId: params.ownerId,
      status: AccountStatus.APPROVED,
    },
  });

  const deal = await prisma.deal.create({
    data: {
      name: `Today-${params.label}`,
      companyName: "Company",
      value: 10_000,
      accountId: account.id,
      ownerId: params.ownerId,
      nextStepType: "FOLLOW_UP",
      nextStepDate: params.nextStepDate,
      lastActivityAt: params.lastActivityAt,
    },
  });

  if (params.includeLatestLog) {
    await prisma.interactionLog.create({
      data: {
        dealId: deal.id,
        interactionType: InteractionType.CALL,
        outcome: Outcome.NO_RESPONSE,
        stakeholderType: StakeholderType.DECISION_MAKER,
        notes: "latest log",
        createdAt: params.includeLatestLog.createdAt,
      },
    });
  }

  return { accountId: account.id, dealId: deal.id };
}

describe("today view API scenarios", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  const anchors = istAnchors(BASE_NOW);
  const { todayYmd, todayStart, todayMinusTwoStart, todayMinusOneStart } = anchors;
  const todayMinusTwoYmd = addDaysYmd(todayYmd, -2);
  const todayMinusOneYmd = addDaysYmd(todayYmd, -1);

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("ranking truth: critical tie uses daysSinceLastActivity when daysOverdue matches", async () => {
    vi.useFakeTimers({ now: BASE_NOW });

    // Both deals have the same nextStepDate -> same daysOverdue, so sorting must be by daysSinceLastActivity.
    const deal11 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      nextStepDate: atIstTime(todayMinusTwoYmd, 23),
      lastActivityAt: new Date(BASE_NOW.getTime() - 11 * DAY_MS - 1),
      label: "critical-11",
    });
    const deal12 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      nextStepDate: atIstTime(todayMinusTwoYmd, 23),
      lastActivityAt: new Date(BASE_NOW.getTime() - 12 * DAY_MS - 1),
      label: "critical-12",
    });

    const res = await getTodayRoute(
      makeRequest("http://localhost/api/today", { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.critical[0].dealId).toBe(deal12.dealId);
    expect(body.critical.map((d: any) => d.dealId)).toContain(deal11.dealId);

    vi.useRealTimers();
  });

  it("time boundary: nextStepDate exactly at critical cutoff start is ATTENTION (not CRITICAL)", async () => {
    vi.useFakeTimers({ now: BASE_NOW });
    expect(new Date().toISOString()).toBe(BASE_NOW.toISOString());

    const attentionDeal = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      // Momentum is NOT CRITICAL when nextStepDate stays on today's IST calendar day.
      nextStepDate: todayStart,
      lastActivityAt: new Date(BASE_NOW.getTime() - 7 * DAY_MS - 1),
      label: "attention-at-cutoff",
    });

    const res = await getTodayRoute(
      makeRequest("http://localhost/api/today", { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const criticalIds = new Set(body.critical.map((d: any) => d.dealId));
    const attentionIds = new Set(body.attention.map((d: any) => d.dealId));
    const upcomingIds = new Set(body.upcoming.map((d: any) => d.dealId));

    expect(criticalIds.has(attentionDeal.dealId)).toBe(false);
    expect(attentionIds.has(attentionDeal.dealId)).toBe(true);
    expect(upcomingIds.has(attentionDeal.dealId)).toBe(false);

    vi.useRealTimers();
  });

  it("silent deal detection: latest InteractionLog overrides stale deal.lastActivityAt", async () => {
    vi.useFakeTimers({ now: BASE_NOW });

    const deal = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      nextStepDate: atIstTime(todayYmd, 23), // should become UPCOMING if computed activity is recent
      lastActivityAt: atIstTime(addDaysYmd(todayYmd, -12), 23), // stale would be critical without logs
      label: "silent-stale-deal",
      includeLatestLog: { createdAt: atIstTime(todayMinusOneYmd, 23) }, // recent enough to avoid critical/attention
    });

    const res = await getTodayRoute(
      makeRequest("http://localhost/api/today", { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const criticalIds = new Set(body.critical.map((d: any) => d.dealId));
    const attentionIds = new Set(body.attention.map((d: any) => d.dealId));
    const upcomingIds = new Set(body.upcoming.map((d: any) => d.dealId));

    expect(criticalIds.has(deal.dealId)).toBe(false);
    expect(attentionIds.has(deal.dealId)).toBe(false);
    expect(upcomingIds.has(deal.dealId)).toBe(true);

    vi.useRealTimers();
  });

  it("regression drift: attention ordering prefers higher daysSinceLastActivity near threshold", async () => {
    vi.useFakeTimers({ now: BASE_NOW });
    expect(new Date().toISOString()).toBe(BASE_NOW.toISOString());

    const deal7 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      nextStepDate: todayStart,
      lastActivityAt: new Date(BASE_NOW.getTime() - 7 * DAY_MS - 1),
      label: "attention-7",
    });
    const deal8 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      nextStepDate: todayStart,
      lastActivityAt: new Date(BASE_NOW.getTime() - 8 * DAY_MS - 1),
      label: "attention-8",
    });

    const res = await getTodayRoute(
      makeRequest("http://localhost/api/today", { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.critical.some((d: any) => d.dealId === deal8.dealId)).toBe(false);
    expect(body.attention[0].dealId).toBe(deal8.dealId);
    expect(body.attention.map((d: any) => d.dealId)).toContain(deal7.dealId);

    vi.useRealTimers();
  });
});

