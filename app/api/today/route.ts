import { NextResponse } from "next/server";
import { DealStatus, Outcome, UserRole } from "@prisma/client";
import { buildDealWhere, getAccessibleUserIds } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { enforceExpiry, getActiveDeals, getExpiryWarning } from "@/lib/expiry";
import { addDaysYmd, formatYmdInIST, istYmdToUtcStart } from "@/lib/ist-time";
import { getDealMomentum } from "@/lib/momentum";
import { prisma } from "@/lib/prisma";
import { scoreDeal } from "@/lib/ranking";

type TodayItem = {
  dealId: string;
  accountName: string;
  owner: { id: string; name: string } | null;
  coOwner: { id: string; name: string } | null;
  nextStepType: string | null;
  nextStepDate: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  daysOverdue: number;
  score: number;
  actionMessage: string;
  reason: string;
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
    upcoming: TodayItem[];
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
    .filter((item) => item.reason === "Overdue or inactive too long")
    .sort(
      (a, b) =>
        b.score - a.score || b.daysOverdue - a.daysOverdue || b.daysSinceLastActivity - a.daysSinceLastActivity,
    );

  const criticalIds = new Set(critical.map((item) => item.dealId));
  const attention = items
    .filter(
      (item) =>
        !criticalIds.has(item.dealId) &&
        (item.reason === "Deal may lose momentum" || item.reason === "No recent activity"),
    )
    .sort((a, b) => b.score - a.score || b.daysSinceLastActivity - a.daysSinceLastActivity);

  const attentionIds = new Set(attention.map((item) => item.dealId));
  const upcoming = items
    .filter((item) => !criticalIds.has(item.dealId) && !attentionIds.has(item.dealId))
    .filter((item) => {
      const nextStep = istYmdToUtcStart(formatYmdInIST(new Date(item.nextStepDate)));
      return nextStep >= todayStart && nextStep <= upcomingEnd;
    })
    .sort(
      (a, b) =>
        b.score - a.score || new Date(a.nextStepDate).getTime() - new Date(b.nextStepDate).getTime(),
    );

  return { critical, attention, upcoming };
}

function colorOrder(color: "RED" | "YELLOW" | "GREEN"): number {
  if (color === "RED") return 0;
  if (color === "YELLOW") return 1;
  return 2;
}

function getOnTrackActionMessage(nextStepType: string | null): string {
  if (!nextStepType) return "Execute next action";
  return `Execute ${nextStepType.replaceAll("_", " ").toLowerCase()}`;
}

function toTodayItem(item: TodayItem & { assigneeId: string | null }): TodayItem {
  return {
    dealId: item.dealId,
    accountName: item.accountName,
    owner: item.owner,
    coOwner: item.coOwner,
    nextStepType: item.nextStepType,
    nextStepDate: item.nextStepDate,
    lastActivityAt: item.lastActivityAt,
    daysSinceLastActivity: item.daysSinceLastActivity,
    daysOverdue: item.daysOverdue,
    score: item.score,
    actionMessage: item.actionMessage,
    reason: item.reason,
  };
}

function applyExpiryWarnings<T extends TodayItem>(
  items: T[],
  expiryWarningsByDealId: Map<string, ReturnType<typeof getExpiryWarning>>,
): T[] {
  return items.map((item) => {
    if (expiryWarningsByDealId.get(item.dealId) !== "EXPIRING_SOON") {
      return item;
    }
    return {
      ...item,
      reason: "Deal nearing expiry due to inactivity",
      actionMessage: "Take action before deal expires",
    };
  });
}

export async function GET(request: Request) {
  try {
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
        ...(reps || []).map((rep) => [rep.id, { name: rep.name, email: rep.email }] as const),
      ]);
    }

    const where: any = {
      ...(await buildDealWhere(user)),
      status: DealStatus.ACTIVE,
    };
    where.nextStepDate = { not: null };

    const deals = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        value: true,
        lastActivityAt: true,
        status: true,
        nextStepType: true,
        nextStepDate: true,
        owner: { select: { id: true, name: true } },
        coOwner: { select: { id: true, name: true } },
        account: { select: { name: true, assignedToId: true } },
      },
    });

    const activeDeals = getActiveDeals(await enforceExpiry(deals || []));
    const dealIds = activeDeals.map((deal) => deal.id);
    const [latestLogs, outcomes] = await Promise.all([
      prisma.interactionLog.groupBy({
        by: ["dealId"],
        where: { dealId: { in: dealIds } },
        _max: { createdAt: true },
      }),
      prisma.interactionLog.findMany({
        where: { dealId: { in: dealIds } },
        select: { dealId: true, outcome: true, createdAt: true },
      }),
    ]);

    const latestLogByDeal = new Map((latestLogs || []).map((row) => [row.dealId, row._max.createdAt]));
    const outcomesByDeal = new Map<string, Outcome[]>();
    for (const row of (outcomes || [])) {
      const arr = outcomesByDeal.get(row.dealId) ?? [];
      arr.push(row.outcome);
      outcomesByDeal.set(row.dealId, arr);
    }
    const logsByDeal = new Map<string, Array<{ createdAt: Date; outcome: Outcome }>>();
    for (const row of (outcomes || [])) {
      const arr = logsByDeal.get(row.dealId) ?? [];
      arr.push({ createdAt: row.createdAt, outcome: row.outcome });
      logsByDeal.set(row.dealId, arr);
    }

    const expiryWarningsByDealId = new Map<string, ReturnType<typeof getExpiryWarning>>();
    const activeItems = (activeDeals || [])
      .filter((deal) => !isInactiveFromOutcomes(outcomesByDeal.get(deal.id) ?? []))
      .map((deal) => {
        const latestLog = latestLogByDeal.get(deal.id) ?? deal.lastActivityAt;
        const momentum = getDealMomentum(
          { lastActivityAt: deal.lastActivityAt, nextStepDate: deal.nextStepDate },
          logsByDeal.get(deal.id) ?? [],
        );
        const nextStepStart = istYmdToUtcStart(formatYmdInIST(deal.nextStepDate!));
        const daysSinceLastActivity = momentum.daysSinceLastActivity || 0;
        const expiryWarning = getExpiryWarning(daysSinceLastActivity);
        expiryWarningsByDealId.set(deal.id, expiryWarning);
        const daysOverdue = diffDaysFloor(todayStart, nextStepStart) || 0;
        const { score } = scoreDeal(
          { value: deal.value || 0, nextStepDate: deal.nextStepDate },
          momentum,
          { todayStartUtc: todayStart, upcomingEndUtc: upcomingEnd },
        );
        let actionMessage = getOnTrackActionMessage(deal.nextStepType);
        let reason = "On track";
        if (momentum.momentumStatus === "CRITICAL") {
          actionMessage = "Follow up immediately";
          reason = "Overdue or inactive too long";
        } else if (momentum.momentumStatus === "AT_RISK") {
          actionMessage = "Follow up on deal";
          reason = "Deal may lose momentum";
        } else if (momentum.momentumStatus === "STALE") {
          actionMessage = "Reconnect";
          reason = "No recent activity";
        }
        return {
          dealId: deal.id,
          assigneeId: deal.account?.assignedToId ?? null,
          accountName: deal.account?.name ?? "Unknown",
          owner: deal.owner ?? null,
          coOwner: deal.coOwner ?? null,
          nextStepType: deal.nextStepType ?? null,
          nextStepDate: deal.nextStepDate!.toISOString(),
          lastActivityAt: latestLog.toISOString(),
          daysSinceLastActivity,
          daysOverdue,
          score: score || 0,
          actionMessage,
          reason,
        };
      });

    if (user.role !== UserRole.MANAGER) {
      const buckets = classify(
        activeItems.map(toTodayItem),
        todayStart,
        todayMinusTwoStart,
        upcomingEnd,
      );
      const response: RepTodayResponse = {
        mode: "REP",
        critical: applyExpiryWarnings(buckets.critical || [], expiryWarningsByDealId),
        attention: applyExpiryWarnings(buckets.attention || [], expiryWarningsByDealId),
        upcoming: applyExpiryWarnings(buckets.upcoming || [], expiryWarningsByDealId),
      };
      return NextResponse.json(response);
    }

    const byRep = new Map<string, TodayItem[]>();
    for (const item of activeItems) {
      if (!item.assigneeId) continue;
      const arr = byRep.get(item.assigneeId) ?? [];
      arr.push(toTodayItem(item));
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
        criticalCount: buckets.critical.length || 0,
        attentionCount: buckets.attention.length || 0,
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
      reps: reps || [],
      selectedRepId: targetRepId,
      drilldown: {
        critical: applyExpiryWarnings(drillBuckets.critical || [], expiryWarningsByDealId),
        attention: applyExpiryWarnings(drillBuckets.attention || [], expiryWarningsByDealId),
        upcoming: applyExpiryWarnings(drillBuckets.upcoming || [], expiryWarningsByDealId),
      },
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("TODAY API ERROR FULL:", err);
    return NextResponse.json(
      { error: "today_failed", details: String(err) },
      { status: 500 }
    );
  }
}
