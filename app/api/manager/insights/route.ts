import { DealStatus, Outcome, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getActivityComplianceRows } from "@/lib/activity-compliance";
import { getCurrentUser } from "@/lib/auth";
import { requireRole } from "@/lib/authz";
import { enforceExpiry, getActiveDeals, getExpiryWarning } from "@/lib/expiry";
import { getDealStageFromOutcomes } from "@/lib/logic/stage";
import { getDealMomentum } from "@/lib/momentum";
import { prisma } from "@/lib/prisma";

type AtRiskDeal = {
  dealId: string;
  accountName: string;
  ownerId: string;
  ownerName: string;
  stage: string;
  value: number;
  daysSinceLastActivity: number;
  reason: string;
};

type RepHealthRow = {
  repId: string;
  repName: string;
  criticalDeals: number;
  staleDeals: number;
  lastActivityAt: string | null;
  activityScore: number;
  color: "RED" | "YELLOW" | "GREEN";
};

type Intervention = {
  dealId: string;
  suggestedAction: string;
};

type ExpiredDealsSummary = {
  totalExpiredDeals: number;
  totalExpiredValue: number;
  byRep: Array<{
    ownerId: string;
    ownerName: string;
    expiredDeals: number;
    expiredValue: number;
  }>;
};

type ExpiringSoonDealsSummary = {
  totalExpiringSoon: number;
  totalValue: number;
  byRep: Array<{
    ownerId: string;
    ownerName: string;
    count: number;
    value: number;
  }>;
};

function getAtRiskReason(params: {
  isOverdue: boolean;
  daysSinceLastActivity: number;
}): string {
  if (params.isOverdue) return "Overdue next step";
  if (params.daysSinceLastActivity > 10) return "No activity > 10 days";
  return "Overdue or inactive too long";
}

function computeActivityScore(params: {
  yesterdayCount: number;
  weeklyActiveDays: number;
  lastActivityAt: Date | null;
}): number {
  const yesterdayPoints = (Math.min(params.yesterdayCount, 3) / 3) * 35;
  const weeklyPoints = (Math.min(params.weeklyActiveDays, 7) / 7) * 45;
  const recencyDays = params.lastActivityAt
    ? Math.max(0, Math.floor((Date.now() - params.lastActivityAt.getTime()) / 86_400_000))
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
  const lowActivity = params.yesterdayCount === 0 && params.weeklyActiveDays < 4;
  if (params.staleDeals > 5 || lowActivity) return "YELLOW";
  return "GREEN";
}

function suggestAction(params: {
  stage: string;
  daysSinceLastActivity: number;
  hasProposalShared: boolean;
}): string {
  if (params.stage === "COMMITTED") {
    return "Manager should step in — high risk close";
  }
  if (params.daysSinceLastActivity > 10) {
    return "Escalate immediately";
  }
  if (params.hasProposalShared && params.daysSinceLastActivity >= 7) {
    return "Push for decision follow-up";
  }
  return "Escalate immediately";
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authz = requireRole(user, [UserRole.MANAGER, UserRole.ADMIN]);
  if (authz) return authz;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessWhere = await buildDealWhere(user);

  const deals = await prisma.deal.findMany({
    where: {
      ...accessWhere,
      status: DealStatus.ACTIVE,
    },
    select: {
      id: true,
      value: true,
      lastActivityAt: true,
      status: true,
      nextStepDate: true,
      ownerId: true,
      owner: { select: { name: true } },
      account: { select: { name: true } },
    },
  });
  const activeDeals = getActiveDeals(await enforceExpiry(deals));
  const expiredDeals = await prisma.deal.findMany({
    where: {
      ...accessWhere,
      status: DealStatus.EXPIRED,
    },
    select: {
      ownerId: true,
      value: true,
      owner: { select: { name: true } },
    },
  });
  const expiredByOwner = new Map<
    string,
    { ownerId: string; ownerName: string; expiredDeals: number; expiredValue: number }
  >();
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
  const expiredDealsSummary: ExpiredDealsSummary = {
    totalExpiredDeals: expiredDeals.length,
    totalExpiredValue: expiredDeals.reduce((sum, deal) => sum + deal.value, 0),
    byRep: [...expiredByOwner.values()].sort(
      (a, b) => b.expiredDeals - a.expiredDeals || b.expiredValue - a.expiredValue,
    ),
  };

  const dealIds = activeDeals.map((d) => d.id);
  const logs = dealIds.length
    ? await prisma.interactionLog.findMany({
        where: { dealId: { in: dealIds } },
        select: { dealId: true, createdAt: true, outcome: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const logsByDealId = new Map<string, Array<{ createdAt: Date; outcome: Outcome }>>();
  const outcomesByDealId = new Map<string, Set<Outcome>>();
  for (const log of logs) {
    const arr = logsByDealId.get(log.dealId) ?? [];
    arr.push({ createdAt: log.createdAt, outcome: log.outcome });
    logsByDealId.set(log.dealId, arr);
    const set = outcomesByDealId.get(log.dealId) ?? new Set<Outcome>();
    set.add(log.outcome);
    outcomesByDealId.set(log.dealId, set);
  }

  const dealSignals = activeDeals.map((deal) => {
    const dealLogs = logsByDealId.get(deal.id) ?? [];
    const momentum = getDealMomentum(
      { lastActivityAt: deal.lastActivityAt, nextStepDate: deal.nextStepDate },
      dealLogs,
    );
    const outcomes = outcomesByDealId.get(deal.id) ?? new Set<Outcome>();
    const stage = getDealStageFromOutcomes([...outcomes]);
    const expiryWarning = getExpiryWarning(momentum.daysSinceLastActivity);
    return { deal, momentum, outcomes, stage, expiryWarning };
  });

  const expiringSoonByOwner = new Map<
    string,
    { ownerId: string; ownerName: string; count: number; value: number }
  >();
  for (const signal of dealSignals) {
    if (signal.expiryWarning !== "EXPIRING_SOON") continue;
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
  const expiringSoonDealsSummary: ExpiringSoonDealsSummary = {
    totalExpiringSoon: [...expiringSoonByOwner.values()].reduce((sum, row) => sum + row.count, 0),
    totalValue: [...expiringSoonByOwner.values()].reduce((sum, row) => sum + row.value, 0),
    byRep: [...expiringSoonByOwner.values()].sort((a, b) => b.count - a.count || b.value - a.value),
  };

  const atRiskDeals: AtRiskDeal[] = dealSignals
    .filter((x) => x.momentum.momentumStatus === "CRITICAL")
    .map((x) => ({
      dealId: x.deal.id,
      accountName: x.deal.account.name,
      ownerId: x.deal.ownerId,
      ownerName: x.deal.owner?.name ?? "Unknown",
      stage: x.stage,
      value: x.deal.value,
      daysSinceLastActivity: x.momentum.daysSinceLastActivity,
      reason: getAtRiskReason({
        isOverdue: x.momentum.isOverdue,
        daysSinceLastActivity: x.momentum.daysSinceLastActivity,
      }),
    }));

  const complianceRows = await getActivityComplianceRows({
    viewer: { id: user.id, role: user.role },
  });

  const repIds = new Set<string>();
  if (user.role === UserRole.MANAGER) {
    const reps = await prisma.user.findMany({
      where: { role: UserRole.REP, managerId: user.id },
      select: { id: true },
    });
    for (const r of reps) repIds.add(r.id);
  } else {
    // ADMIN: keep lightweight but useful — report across all reps.
    const reps = await prisma.user.findMany({
      where: { role: UserRole.REP },
      select: { id: true },
    });
    for (const r of reps) repIds.add(r.id);
  }

  const criticalByOwner = new Map<string, number>();
  const staleByOwner = new Map<string, number>();
  for (const x of dealSignals) {
    const ownerId = x.deal.ownerId;
    if (x.momentum.momentumStatus === "CRITICAL") {
      criticalByOwner.set(ownerId, (criticalByOwner.get(ownerId) ?? 0) + 1);
    }
    if (x.momentum.momentumStatus === "STALE") {
      staleByOwner.set(ownerId, (staleByOwner.get(ownerId) ?? 0) + 1);
    }
  }

  const repHealth: RepHealthRow[] = complianceRows
    .filter((r) => repIds.has(r.userId))
    .map((r) => {
      const criticalDeals = criticalByOwner.get(r.userId) ?? 0;
      const staleDeals = staleByOwner.get(r.userId) ?? 0;
      const activityScore = computeActivityScore({
        yesterdayCount: r.yesterdayCount,
        weeklyActiveDays: r.weeklyActiveDays,
        lastActivityAt: r.lastActivityAt,
      });
      const color = repColor({
        criticalDeals,
        staleDeals,
        yesterdayCount: r.yesterdayCount,
        weeklyActiveDays: r.weeklyActiveDays,
      });
      return {
        repId: r.userId,
        repName: r.name,
        criticalDeals,
        staleDeals,
        lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
        activityScore,
        color,
      };
    });

  const interventions: Intervention[] = atRiskDeals.map((d) => {
    const outcomes = outcomesByDealId.get(d.dealId) ?? new Set<Outcome>();
    const hasProposalShared = outcomes.has(Outcome.PROPOSAL_SHARED);
    return {
      dealId: d.dealId,
      suggestedAction: suggestAction({
        stage: d.stage,
        daysSinceLastActivity: d.daysSinceLastActivity,
        hasProposalShared,
      }),
    };
  });

  return NextResponse.json({
    atRiskDeals,
    repHealth,
    interventions,
    expiredDealsSummary,
    expiringSoonDealsSummary,
  });
}

