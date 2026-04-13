import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

type StageKey = "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED" | "CLOSED";
type StageCounts = Record<StageKey, number>;

type ManagerBreakdownRow = {
  managerId: string;
  managerName: string;
  stages: StageCounts;
  totalValue: number;
};

function emptyStages(): StageCounts {
  return {
    ACCESS: 0,
    QUALIFIED: 0,
    EVALUATION: 0,
    COMMITTED: 0,
    CLOSED: 0,
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const managers = await prisma.user.findMany({
    where: { role: UserRole.MANAGER },
    select: { id: true, name: true },
  });

  const reports = await prisma.user.findMany({
    where: {
      role: UserRole.REP,
      managerId: { in: managers.map((manager) => manager.id) },
    },
    select: { id: true, managerId: true },
  });

  const repIds = reports.map((report) => report.id);
  const deals = repIds.length
    ? await prisma.deal.findMany({
        where: { ownerId: { in: repIds } },
        select: { id: true, value: true, ownerId: true },
      })
    : [];

  const reportManagerByRepId = new Map<string, string>();
  for (const report of reports) {
    if (!report.managerId) continue;
    reportManagerByRepId.set(report.id, report.managerId);
  }

  const rowsByManager = new Map<string, ManagerBreakdownRow>();
  for (const manager of managers) {
    rowsByManager.set(manager.id, {
      managerId: manager.id,
      managerName: manager.name,
      stages: emptyStages(),
      totalValue: 0,
    });
  }

  const stageByDealId = new Map<string, StageKey>();
  await Promise.all(
    deals.map(async (deal) => {
      stageByDealId.set(deal.id, (await getDealStage(deal.id)) as StageKey);
    }),
  );

  for (const deal of deals) {
    const managerId = reportManagerByRepId.get(deal.ownerId);
    if (!managerId) continue;
    const row = rowsByManager.get(managerId);
    if (!row) continue;
    const stage = stageByDealId.get(deal.id);
    if (!stage) continue;
    row.stages[stage] += 1;
    row.totalValue += deal.value;
  }

  return NextResponse.json(Array.from(rowsByManager.values()));
}
