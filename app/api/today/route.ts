import { NextResponse } from "next/server";
import { Outcome, UserRole } from "@prisma/client";
import { buildDealWhere, getAccessibleUserIds } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { addDaysYmd, formatYmdInIST, istYmdToUtcStart } from "@/lib/ist-time";
import { prisma } from "@/lib/prisma";

type TodayItem = {
  dealId: string;
  accountName: string;
  nextStepType: string | null;
  nextStepDate: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  daysOverdue: number;
};

type RepTodayResponse = {
  mode: "REP";
  critical: TodayItem[];
  attention: TodayItem[];
  upcoming: TodayItem[];
};

type ManagerRepSummary = {
  repId: string;
  repName: string;
  repEmail: string;
  color: "RED" | "YELLOW" | "GREEN";
  stale: boolean;
  hasCritical: boolean;
  criticalCount: number;
  attentionCount: number;
};

type ManagerTodayResponse = {
  mode: "MANAGER";
  reps: ManagerRepSummary[];
  selectedRepId: string | null;
  drilldown: {
    critical: TodayItem[];
    attention: TodayItem[];
  };
};

const DAY_MS = 86_400_000;

function diffDaysFloor(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function isInactiveFromOutcomes(outcomes: Outcome[]): boolean {
  const set = new Set(outcomes);
  const isLost = set.has(Outcome.DEAL_DROPPED) || set.has(Outcome.LOST_TO_COMPETITOR);
  const isClosedWon = set.has(Outcome.DEAL_CONFIRMED) && set.has(Outcome.PO_RECEIVED);
  return isLost || isClosedWon;
}

function classify(items: TodayItem[], todayStart: Date, todayMinusTwoStart: Date, upcomingEnd: Date) {
  const critical = items
    .filter(
      (item) =>
        istYmdToUtcStart(formatYmdInIST(new Date(item.nextStepDate))) < todayMinusTwoStart ||
        item.daysSinceLastActivity >= 10,
    )
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.daysSinceLastActivity - a.daysSinceLastActivity);

  const criticalIds = new Set(critical.map((item) => item.dealId));
  const attention = items
    .filter((item) => !criticalIds.has(item.dealId) && item.daysSinceLastActivity >= 7)
    .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity);

  const upcoming = items
    .filter((item) => {
      const nextStep = istYmdToUtcStart(formatYmdInIST(new Date(item.nextStepDate)));
      return nextStep >= todayStart && nextStep <= upcomingEnd;
    })
    .sort((a, b) => new Date(a.nextStepDate).getTime() - new Date(b.nextStepDate).getTime());

  return { critical, attention, upcoming };
}

function colorOrder(color: "RED" | "YELLOW" | "GREEN"): number {
  if (color === "RED") return 0;
  if (color === "YELLOW") return 1;
  return 2;
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  const url = new URL(request.url);
  const selectedRepId = url.searchParams.get("repId");

  const now = new Date();
  const todayYmd = formatYmdInIST(now);
  const todayStart = istYmdToUtcStart(todayYmd);
  const todayMinusTwoStart = istYmdToUtcStart(addDaysYmd(todayYmd, -2));
  const upcomingEnd = istYmdToUtcStart(addDaysYmd(todayYmd, 2));

  const assigneeIds = await getAccessibleUserIds(user);
  let assigneeDirectory = new Map<string, { name: string; email: string }>();
  if (user.role === UserRole.MANAGER) {
    const reps = await prisma.user.findMany({
      where: { managerId: user.id, role: UserRole.REP },
      select: { id: true, name: true, email: true },
    });
    assigneeDirectory = new Map([
      [user.id, { name: user.name, email: user.email }],
      ...reps.map((rep) => [rep.id, { name: rep.name, email: rep.email }] as const),
    ]);
  }

  const where = await buildDealWhere(user);
  where.nextStepDate = { not: null };

  const deals = await prisma.deal.findMany({
    where,
    select: {
      id: true,
      lastActivityAt: true,
      nextStepType: true,
      nextStepDate: true,
      account: { select: { name: true, assignedToId: true } },
    },
  });

  const dealIds = deals.map((deal) => deal.id);
  const [latestLogs, outcomes] = await Promise.all([
    prisma.interactionLog.groupBy({
      by: ["dealId"],
      where: { dealId: { in: dealIds } },
      _max: { createdAt: true },
    }),
    prisma.interactionLog.findMany({
      where: { dealId: { in: dealIds } },
      select: { dealId: true, outcome: true },
    }),
  ]);
  const latestLogByDeal = new Map(latestLogs.map((row) => [row.dealId, row._max.createdAt]));
  const outcomesByDeal = new Map<string, Outcome[]>();
  for (const row of outcomes) {
    const arr = outcomesByDeal.get(row.dealId) ?? [];
    arr.push(row.outcome);
    outcomesByDeal.set(row.dealId, arr);
  }

  const activeItems = deals
    .filter((deal) => !isInactiveFromOutcomes(outcomesByDeal.get(deal.id) ?? []))
    .map((deal) => {
      const latestLog = latestLogByDeal.get(deal.id) ?? deal.lastActivityAt;
      const nextStepStart = istYmdToUtcStart(formatYmdInIST(deal.nextStepDate!));
      const lastActivityStart = istYmdToUtcStart(formatYmdInIST(latestLog));
      const daysSinceLastActivity = diffDaysFloor(todayStart, lastActivityStart);
      const daysOverdue = diffDaysFloor(todayStart, nextStepStart);
      return {
        dealId: deal.id,
        assigneeId: deal.account.assignedToId,
        accountName: deal.account.name,
        nextStepType: deal.nextStepType,
        nextStepDate: deal.nextStepDate!.toISOString(),
        lastActivityAt: latestLog.toISOString(),
        daysSinceLastActivity,
        daysOverdue,
      };
    });

  if (user.role !== UserRole.MANAGER) {
    const buckets = classify(
      activeItems.map(({ assigneeId: _assigneeId, ...item }) => item),
      todayStart,
      todayMinusTwoStart,
      upcomingEnd,
    );
    const response: RepTodayResponse = { mode: "REP", ...buckets };
    return NextResponse.json(response);
  }

  const byRep = new Map<string, TodayItem[]>();
  for (const item of activeItems) {
    if (!item.assigneeId) continue;
    const arr = byRep.get(item.assigneeId) ?? [];
    const { assigneeId: _assigneeId, ...rest } = item;
    arr.push(rest);
    byRep.set(item.assigneeId, arr);
  }

  const reps: ManagerRepSummary[] = (assigneeIds ?? []).map((repId) => {
    const items = byRep.get(repId) ?? [];
    const buckets = classify(items, todayStart, todayMinusTwoStart, upcomingEnd);
    const maxDays = items.length ? Math.max(...items.map((item) => item.daysSinceLastActivity)) : 0;
    const hasCritical = buckets.critical.length > 0;
    const stale = maxDays >= 7;
    const color: "RED" | "YELLOW" | "GREEN" = hasCritical
      ? "RED"
      : stale || buckets.attention.length > 0
        ? "YELLOW"
        : "GREEN";
    const repMeta = assigneeDirectory.get(repId);
    return {
      repId,
      repName: repMeta?.name ?? "Unknown",
      repEmail: repMeta?.email ?? "",
      color,
      stale,
      hasCritical,
      criticalCount: buckets.critical.length,
      attentionCount: buckets.attention.length,
    };
  });
  reps.sort((a, b) => colorOrder(a.color) - colorOrder(b.color));

  const targetRepId =
    selectedRepId && (assigneeIds ?? []).includes(selectedRepId)
      ? selectedRepId
      : reps[0]?.repId ?? null;
  const drillItems = targetRepId ? byRep.get(targetRepId) ?? [] : [];
  const drillBuckets = classify(drillItems, todayStart, todayMinusTwoStart, upcomingEnd);

  const response: ManagerTodayResponse = {
    mode: "MANAGER",
    reps,
    selectedRepId: targetRepId,
    drilldown: {
      critical: drillBuckets.critical,
      attention: drillBuckets.attention,
    },
  };
  return NextResponse.json(response);
}
