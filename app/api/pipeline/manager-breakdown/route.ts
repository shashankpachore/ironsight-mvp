import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

type StageKey = "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED";
type StageSummary = { count: number; value: number };
type StageCounts = Record<StageKey, StageSummary>;
type TerminalOutcomeKey = "CLOSED" | "LOST";
type TerminalOutcomes = Record<TerminalOutcomeKey, { count: number; value: number }>;

type ManagerBreakdownRow = {
  managerId: string;
  managerName: string;
  stages: StageCounts;
  totalValue: number;
  outcomes: TerminalOutcomes;
};

const UNASSIGNED_ROW_ID = "UNASSIGNED";
const UNASSIGNED_ROW_NAME = "Unassigned";

function emptyStages(): StageCounts {
  return {
    ACCESS: { count: 0, value: 0 },
    QUALIFIED: { count: 0, value: 0 },
    EVALUATION: { count: 0, value: 0 },
    COMMITTED: { count: 0, value: 0 },
  };
}

function isPipelineStage(stage: string): stage is StageKey {
  return stage === "ACCESS" || stage === "QUALIFIED" || stage === "EVALUATION" || stage === "COMMITTED";
}

function isTerminalStage(stage: string): stage is TerminalOutcomeKey {
  return stage === "CLOSED" || stage === "LOST";
}

function emptyOutcomes(): TerminalOutcomes {
  return {
    CLOSED: { count: 0, value: 0 },
    LOST: { count: 0, value: 0 },
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

  const assigneeManagerById = new Map<string, string>();
  for (const manager of managers) {
    assigneeManagerById.set(manager.id, manager.id);
  }
  for (const report of reports) {
    if (!report.managerId) continue;
    assigneeManagerById.set(report.id, report.managerId);
  }

  const rowsByManager = new Map<string, ManagerBreakdownRow>();
  for (const manager of managers) {
    rowsByManager.set(manager.id, {
      managerId: manager.id,
      managerName: manager.name,
      stages: emptyStages(),
      totalValue: 0,
      outcomes: emptyOutcomes(),
    });
  }
  rowsByManager.set(UNASSIGNED_ROW_ID, {
    managerId: UNASSIGNED_ROW_ID,
    managerName: UNASSIGNED_ROW_NAME,
    stages: emptyStages(),
    totalValue: 0,
    outcomes: emptyOutcomes(),
  });

  const where = await buildDealWhere(user);
  const deals = await prisma.deal.findMany({
    where,
    select: {
      id: true,
      value: true,
      account: { select: { assignedToId: true } },
    },
  });

  const stageByDealId = new Map<string, string>();
  await Promise.all(
    deals.map(async (deal) => {
      stageByDealId.set(deal.id, await getDealStage(deal.id));
    }),
  );

  for (const deal of deals) {
    const assignedToId = deal.account.assignedToId;
    const managerId = assignedToId ? assigneeManagerById.get(assignedToId) : undefined;
    const rowId = managerId ?? UNASSIGNED_ROW_ID;
    const row = rowsByManager.get(rowId);
    if (!row) continue;
    const stage = stageByDealId.get(deal.id);
    if (!stage) continue;
    if (isPipelineStage(stage)) {
      row.stages[stage].count += 1;
      row.stages[stage].value += deal.value;
      row.totalValue += deal.value;
      continue;
    }
    if (!isTerminalStage(stage)) continue;
    row.outcomes[stage].count += 1;
    row.outcomes[stage].value += deal.value;
  }

  return NextResponse.json(Array.from(rowsByManager.values()));
}
