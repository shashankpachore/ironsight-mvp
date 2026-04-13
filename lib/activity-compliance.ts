import { Prisma, UserRole } from "@prisma/client";
import { formatYmdInIST, getComplianceWindows } from "@/lib/ist-time";
import { prisma } from "@/lib/prisma";

/**
 * InteractionLog has no createdById. We attribute logs to reps via deal.ownerId — the rep who
 * owns the deal (same user who may log per assignee-only rules in normal flows).
 */
export type ActivityComplianceRow = {
  userId: string;
  name: string;
  yesterdayCount: number;
  lastActivityAt: Date | null;
  weeklyActiveDays: number;
};

export async function getActivityComplianceRows(params: {
  viewer: { id: string; role: UserRole };
  now?: Date;
}): Promise<ActivityComplianceRow[]> {
  const now = params.now ?? new Date();
  const w = getComplianceWindows(now);

  const repWhere: Prisma.UserWhereInput =
    params.viewer.role === UserRole.MANAGER
      ? { role: UserRole.REP, managerId: params.viewer.id }
      : { role: UserRole.REP };

  const reps = await prisma.user.findMany({
    where: repWhere,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const repIds = reps.map((r) => r.id);
  if (repIds.length === 0) {
    return [];
  }

  const windowLogs = await prisma.interactionLog.findMany({
    where: {
      createdAt: { gte: w.weekStartUtc, lte: w.todayEndUtc },
      deal: { ownerId: { in: repIds } },
    },
    select: {
      createdAt: true,
      deal: { select: { ownerId: true } },
    },
  });

  const lastByOwner = new Map<string, Date | null>();
  const allLogsDesc = await prisma.interactionLog.findMany({
    where: { deal: { ownerId: { in: repIds } } },
    select: {
      createdAt: true,
      deal: { select: { ownerId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  for (const log of allLogsDesc) {
    if (!lastByOwner.has(log.deal.ownerId)) {
      lastByOwner.set(log.deal.ownerId, log.createdAt);
    }
  }

  const yesterdayCountByOwner = new Map<string, number>();
  const weeklyDaysByOwner = new Map<string, Set<string>>();

  for (const repId of repIds) {
    yesterdayCountByOwner.set(repId, 0);
    weeklyDaysByOwner.set(repId, new Set());
  }

  for (const log of windowLogs) {
    const ownerId = log.deal.ownerId;
    const t = log.createdAt.getTime();
    if (t >= w.yesterdayStartUtc.getTime() && t <= w.yesterdayEndUtc.getTime()) {
      yesterdayCountByOwner.set(ownerId, (yesterdayCountByOwner.get(ownerId) ?? 0) + 1);
    }
    if (t >= w.weekStartUtc.getTime() && t <= w.todayEndUtc.getTime()) {
      const ymd = formatYmdInIST(log.createdAt);
      weeklyDaysByOwner.get(ownerId)?.add(ymd);
    }
  }

  const rows: ActivityComplianceRow[] = reps.map((rep) => ({
    userId: rep.id,
    name: rep.name,
    yesterdayCount: yesterdayCountByOwner.get(rep.id) ?? 0,
    lastActivityAt: lastByOwner.get(rep.id) ?? null,
    weeklyActiveDays: weeklyDaysByOwner.get(rep.id)?.size ?? 0,
  }));

  rows.sort((a, b) => {
    if (a.yesterdayCount !== b.yesterdayCount) {
      return a.yesterdayCount - b.yesterdayCount;
    }
    const ta = a.lastActivityAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const tb = b.lastActivityAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return rows;
}
