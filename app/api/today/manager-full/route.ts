import { DealStatus, Outcome, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildDealWhere } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { enforceExpiry, getActiveDeals, getExpiryWarning } from "@/lib/expiry";
import { addDaysYmd, formatYmdInIST, istYmdToUtcStart } from "@/lib/ist-time";
import { getDealStageFromLogs } from "@/lib/deals";
import { getDealMomentum } from "@/lib/momentum";
import { prisma } from "@/lib/prisma";
import { scoreDeal } from "@/lib/ranking";

const DAY_MS = 86_400_000;

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

function diffDaysFloor(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function isInactiveFromOutcomes(outcomes: Outcome[]): boolean {
  const set = new Set(outcomes);
  return (
    set.has(Outcome.DEAL_DROPPED) ||
    set.has(Outcome.LOST_TO_COMPETITOR) ||
    (set.has(Outcome.DEAL_CONFIRMED) && set.has(Outcome.PO_RECEIVED))
  );
}

function classify(items: TodayItem[], todayStart: Date, upcomingEnd: Date) {
  const critical = items
    .filter((item) => item.reason === "Overdue or inactive too long")
    .sort((a, b) => b.score - a.score || b.daysOverdue - a.daysOverdue);
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
    .sort((a, b) => b.score - a.score);
  return { critical, attention, upcoming };
}

function getOnTrackActionMessage(nextStepType: string | null): string {
  if (!nextStepType) return "Execute next action";
  return `Execute ${nextStepType.replaceAll("_", " ").toLowerCase()}`;
}

function colorOrder(color: "RED" | "YELLOW" | "GREEN"): number {
  if (color === "RED") return 0;
  if (color === "YELLOW") return 1;
  return 2;
}

function applyExpiryWarnings<T extends TodayItem>(
  items: T[],
  expiryWarningsByDealId: Map<string, ReturnType<typeof getExpiryWarning>>,
): T[] {
  return items.map((item) =>
    expiryWarningsByDealId.get(item.dealId) === "EXPIRING_SOON"
      ? {
          ...item,
          reason: "Deal nearing expiry due to inactivity",
          actionMessage: "Take action before deal expires",
        }
      : item,
  );
}

function getAtRiskReason(params: { isOverdue: boolean; daysSinceLastActivity: number }): string {
  if (params.isOverdue) return "Overdue next step";
  if (params.daysSinceLastActivity > 10) return "No activity > 10 days";
  return "Overdue or inactive too long";
}

function suggestAction(params: { stage: string; daysSinceLastActivity: number; hasProposalShared: boolean }): string {
  if (params.stage === "COMMITTED") return "Manager should step in - high risk close";
  if (params.daysSinceLastActivity > 10) return "Escalate immediately";
  if (params.hasProposalShared && params.daysSinceLastActivity >= 7) return "Push for decision follow-up";
  return "Escalate immediately";
}

function computeActivityScore(params: { yesterdayCount: number; weeklyActiveDays: number; lastActivityAt: Date | null }) {
  const yesterdayPoints = (Math.min(params.yesterdayCount, 3) / 3) * 35;
  const weeklyPoints = (Math.min(params.weeklyActiveDays, 7) / 7) * 45;
  const recencyDays = params.lastActivityAt
    ? Math.max(0, Math.floor((Date.now() - params.lastActivityAt.getTime()) / DAY_MS))
    : 30;
  const recencyPoints = Math.max(0, 20 - Math.min(recencyDays, 10) * 2);
  return Math.round(yesterdayPoints + weeklyPoints + recencyPoints);
}

function repColor(params: {
  criticalDeals: number;
  staleDeals: number;
  yesterdayCount: number;
  weeklyActiveDays: number;
}): "RED" | "YELLOW" | "GREEN" {
  if (params.criticalDeals > 5) return "RED";
  if (params.staleDeals > 5 || (params.yesterdayCount === 0 && params.weeklyActiveDays < 4)) return "YELLOW";
  return "GREEN";
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authz = requireRole(user, [UserRole.MANAGER]);
  if (authz) return authz;
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const reps = await prisma.user.findMany({
    where: { managerId: user.id, role: UserRole.REP },
    select: { id: true, name: true, email: true },
  });
  const assigneeIds = [user.id, ...reps.map((rep) => rep.id)];
  const assigneeDirectory = new Map([
    [user.id, { name: user.name, email: user.email }],
    ...reps.map((rep) => [rep.id, { name: rep.name, email: rep.email }] as const),
  ]);

  const accessWhere = await buildDealWhere(user);
  const activeDealRows = await prisma.deal.findMany({
    where: { ...accessWhere, status: DealStatus.ACTIVE },
    select: {
      id: true,
      value: true,
      lastActivityAt: true,
      status: true,
      nextStepType: true,
      nextStepDate: true,
      ownerId: true,
      owner: { select: { name: true } },
      coOwner: { select: { id: true, name: true } },
      account: { select: { name: true, assignedToId: true } },
    },
  });
  const activeDeals = getActiveDeals(await enforceExpiry(activeDealRows));
  const dealIds = activeDeals.map((deal) => deal.id);
  const logs = dealIds.length
    ? await prisma.interactionLog.findMany({
        where: { dealId: { in: dealIds } },
        select: { dealId: true, createdAt: true, outcome: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const logsByDealId = new Map<string, Array<{ createdAt: Date; outcome: Outcome }>>();
  const outcomesByDealId = new Map<string, Set<Outcome>>();
  const lastActivityByOwner = new Map<string, Date>();
  const yesterdayCountByOwner = new Map<string, number>();
  const weeklyDaysByOwner = new Map<string, Set<string>>();
  const todayYmd = formatYmdInIST(new Date());
  const yesterdayYmd = formatYmdInIST(istYmdToUtcStart(addDaysYmd(todayYmd, -1)));
  const weekStart = istYmdToUtcStart(addDaysYmd(todayYmd, -6));
  const ownerByDealId = new Map(activeDeals.map((deal) => [deal.id, deal.ownerId]));

  for (const log of logs) {
    const arr = logsByDealId.get(log.dealId) ?? [];
    arr.push({ createdAt: log.createdAt, outcome: log.outcome });
    logsByDealId.set(log.dealId, arr);
    const outcomes = outcomesByDealId.get(log.dealId) ?? new Set<Outcome>();
    outcomes.add(log.outcome);
    outcomesByDealId.set(log.dealId, outcomes);
    const ownerId = ownerByDealId.get(log.dealId);
    if (!ownerId) continue;
    const previousLast = lastActivityByOwner.get(ownerId);
    if (!previousLast || log.createdAt > previousLast) lastActivityByOwner.set(ownerId, log.createdAt);
    const logYmd = formatYmdInIST(log.createdAt);
    if (logYmd === yesterdayYmd) {
      yesterdayCountByOwner.set(ownerId, (yesterdayCountByOwner.get(ownerId) ?? 0) + 1);
    }
    if (log.createdAt >= weekStart) {
      const days = weeklyDaysByOwner.get(ownerId) ?? new Set<string>();
      days.add(logYmd);
      weeklyDaysByOwner.set(ownerId, days);
    }
  }

  const todayStart = istYmdToUtcStart(todayYmd);
  const upcomingEnd = istYmdToUtcStart(addDaysYmd(todayYmd, 2));
  const expiryWarningsByDealId = new Map<string, ReturnType<typeof getExpiryWarning>>();
  const activeItems = activeDeals
    .filter((deal) => deal.nextStepDate)
    .filter((deal) => !isInactiveFromOutcomes([...(outcomesByDealId.get(deal.id) ?? new Set<Outcome>())]))
    .map((deal) => {
      const dealLogs = logsByDealId.get(deal.id) ?? [];
      const latestLog = dealLogs.at(-1)?.createdAt ?? deal.lastActivityAt;
      const momentum = getDealMomentum(
        { lastActivityAt: deal.lastActivityAt, nextStepDate: deal.nextStepDate },
        dealLogs,
      );
      const expiryWarning = getExpiryWarning(momentum.daysSinceLastActivity);
      expiryWarningsByDealId.set(deal.id, expiryWarning);
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
        assigneeId: deal.account.assignedToId,
        accountName: deal.account.name,
        owner: deal.owner ? { id: deal.ownerId, name: deal.owner.name } : null,
        coOwner: deal.coOwner,
        nextStepType: deal.nextStepType,
        nextStepDate: deal.nextStepDate!.toISOString(),
        lastActivityAt: latestLog.toISOString(),
        daysSinceLastActivity: momentum.daysSinceLastActivity,
        daysOverdue: diffDaysFloor(todayStart, istYmdToUtcStart(formatYmdInIST(deal.nextStepDate!))),
        score: scoreDeal({ value: deal.value, nextStepDate: deal.nextStepDate }, momentum, {
          todayStartUtc: todayStart,
          upcomingEndUtc: upcomingEnd,
        }).score,
        actionMessage,
        reason,
      };
    });

  const byRep = new Map<string, TodayItem[]>();
  for (const item of activeItems) {
    if (!item.assigneeId) continue;
    const arr = byRep.get(item.assigneeId) ?? [];
    arr.push(item);
    byRep.set(item.assigneeId, arr);
  }
  const todayReps = assigneeIds.map((repId) => {
    const items = byRep.get(repId) ?? [];
    const buckets = classify(items, todayStart, upcomingEnd);
    const maxDays = items.length ? Math.max(...items.map((item) => item.daysSinceLastActivity)) : 0;
    const hasCritical = buckets.critical.length > 0;
    const color: "RED" | "YELLOW" | "GREEN" = hasCritical
      ? "RED"
      : maxDays >= 7 || buckets.attention.length > 0
        ? "YELLOW"
        : "GREEN";
    const meta = assigneeDirectory.get(repId);
    return {
      repId,
      repName: meta?.name ?? "Unknown",
      repEmail: meta?.email ?? "",
      color,
      stale: maxDays >= 7,
      hasCritical,
      criticalCount: buckets.critical.length,
      attentionCount: buckets.attention.length,
    };
  });
  todayReps.sort((a, b) => colorOrder(a.color) - colorOrder(b.color));
  const drillItems = byRep.get(user.id) ?? [];
  const drillBuckets = classify(drillItems, todayStart, upcomingEnd);

  const dealSignals = activeDeals.map((deal) => {
    const dealLogs = logsByDealId.get(deal.id) ?? [];
    const momentum = getDealMomentum(
      { lastActivityAt: deal.lastActivityAt, nextStepDate: deal.nextStepDate },
      dealLogs,
    );
    const outcomes = outcomesByDealId.get(deal.id) ?? new Set<Outcome>();
    const stage = getDealStageFromLogs(dealLogs);
    const expiryWarning = getExpiryWarning(momentum.daysSinceLastActivity);
    return { deal, momentum, outcomes, stage, expiryWarning };
  });

  const expiredDeals = await prisma.deal.findMany({
    where: { ...accessWhere, status: DealStatus.EXPIRED },
    select: { ownerId: true, value: true, owner: { select: { name: true } } },
  });
  const expiredByOwner = new Map<string, { ownerId: string; ownerName: string; expiredDeals: number; expiredValue: number }>();
  for (const deal of expiredDeals) {
    const row = expiredByOwner.get(deal.ownerId) ?? {
      ownerId: deal.ownerId,
      ownerName: deal.owner?.name ?? "Unknown",
      expiredDeals: 0,
      expiredValue: 0,
    };
    row.expiredDeals += 1;
    row.expiredValue += deal.value;
    expiredByOwner.set(deal.ownerId, row);
  }

  const expiringSoonByOwner = new Map<string, { ownerId: string; ownerName: string; count: number; value: number }>();
  const atRiskDeals = [];
  const criticalByOwner = new Map<string, number>();
  const staleByOwner = new Map<string, number>();
  for (const signal of dealSignals) {
    if (signal.expiryWarning === "EXPIRING_SOON") {
      const row = expiringSoonByOwner.get(signal.deal.ownerId) ?? {
        ownerId: signal.deal.ownerId,
        ownerName: signal.deal.owner?.name ?? "Unknown",
        count: 0,
        value: 0,
      };
      row.count += 1;
      row.value += signal.deal.value;
      expiringSoonByOwner.set(signal.deal.ownerId, row);
    }
    if (signal.momentum.momentumStatus === "CRITICAL") {
      criticalByOwner.set(signal.deal.ownerId, (criticalByOwner.get(signal.deal.ownerId) ?? 0) + 1);
      atRiskDeals.push({
        dealId: signal.deal.id,
        accountName: signal.deal.account.name,
        ownerId: signal.deal.ownerId,
        ownerName: signal.deal.owner?.name ?? "Unknown",
        stage: signal.stage,
        value: signal.deal.value,
        daysSinceLastActivity: signal.momentum.daysSinceLastActivity,
        reason: getAtRiskReason({
          isOverdue: signal.momentum.isOverdue,
          daysSinceLastActivity: signal.momentum.daysSinceLastActivity,
        }),
      });
    }
    if (signal.momentum.momentumStatus === "STALE") {
      staleByOwner.set(signal.deal.ownerId, (staleByOwner.get(signal.deal.ownerId) ?? 0) + 1);
    }
  }

  const repHealth = assigneeIds.map((repId) => {
    const yesterdayCount = yesterdayCountByOwner.get(repId) ?? 0;
    const weeklyActiveDays = weeklyDaysByOwner.get(repId)?.size ?? 0;
    const lastActivityAt = lastActivityByOwner.get(repId) ?? null;
    const criticalDeals = criticalByOwner.get(repId) ?? 0;
    const staleDeals = staleByOwner.get(repId) ?? 0;
    return {
      repId,
      repName: assigneeDirectory.get(repId)?.name ?? "Unknown",
      criticalDeals,
      staleDeals,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
      activityScore: computeActivityScore({ yesterdayCount, weeklyActiveDays, lastActivityAt }),
      color: repColor({ criticalDeals, staleDeals, yesterdayCount, weeklyActiveDays }),
    };
  });

  const interventions = atRiskDeals.map((deal) => ({
    dealId: deal.dealId,
    suggestedAction: suggestAction({
      stage: deal.stage,
      daysSinceLastActivity: deal.daysSinceLastActivity,
      hasProposalShared: outcomesByDealId.get(deal.dealId)?.has(Outcome.PROPOSAL_SHARED) ?? false,
    }),
  }));

  return NextResponse.json({
    today: {
      mode: "MANAGER",
      reps: todayReps,
      selectedRepId: user.id,
      drilldown: {
        critical: applyExpiryWarnings(drillBuckets.critical, expiryWarningsByDealId),
        attention: applyExpiryWarnings(drillBuckets.attention, expiryWarningsByDealId),
        upcoming: applyExpiryWarnings(drillBuckets.upcoming, expiryWarningsByDealId),
      },
    },
    insights: {
      atRiskDeals,
      repHealth,
      interventions,
      expiredDealsSummary: {
        totalExpiredDeals: expiredDeals.length,
        totalExpiredValue: expiredDeals.reduce((sum, deal) => sum + deal.value, 0),
        byRep: [...expiredByOwner.values()].sort((a, b) => b.expiredDeals - a.expiredDeals),
      },
      expiringSoonDealsSummary: {
        totalExpiringSoon: [...expiringSoonByOwner.values()].reduce((sum, row) => sum + row.count, 0),
        totalValue: [...expiringSoonByOwner.values()].reduce((sum, row) => sum + row.value, 0),
        byRep: [...expiringSoonByOwner.values()].sort((a, b) => b.count - a.count || b.value - a.value),
      },
    },
  });
}
