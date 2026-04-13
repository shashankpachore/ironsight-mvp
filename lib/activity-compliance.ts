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

  const usersWhere: Prisma.UserWhereInput =
    params.viewer.role === UserRole.MANAGER
      ? {
          OR: [
            { id: params.viewer.id, role: UserRole.MANAGER },
            { role: UserRole.REP, managerId: params.viewer.id },
          ],
        }
      : { role: { in: [UserRole.REP, UserRole.MANAGER] } };

  const users = await prisma.user.findMany({
    where: usersWhere,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) {
    return [];
  }

  const windowLogs = await prisma.interactionLog.findMany({
    where: {
      createdAt: { gte: w.weekStartUtc, lte: w.todayEndUtc },
      deal: { ownerId: { in: userIds } },
    },
    select: {
      createdAt: true,
      deal: { select: { ownerId: true } },
    },
  });

  const lastByOwner = new Map<string, Date | null>();
  const allLogsDesc = await prisma.interactionLog.findMany({
    where: { deal: { ownerId: { in: userIds } } },
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

  for (const userId of userIds) {
    yesterdayCountByOwner.set(userId, 0);
    weeklyDaysByOwner.set(userId, new Set());
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

  const rows: ActivityComplianceRow[] = users.map((user) => ({
    userId: user.id,
    name: user.name,
    yesterdayCount: yesterdayCountByOwner.get(user.id) ?? 0,
    lastActivityAt: lastByOwner.get(user.id) ?? null,
    weeklyActiveDays: weeklyDaysByOwner.get(user.id)?.size ?? 0,
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
