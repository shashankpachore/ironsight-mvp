import { DealStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStageFromLogs } from "@/lib/deals";
import { enforceExpiry, getActiveDeals } from "@/lib/expiry";
import { prisma } from "@/lib/prisma";
import { PRODUCT_OPTIONS } from "@/lib/products";

type StageKey = "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED";
type PipelineShape = Record<StageKey, { count: number; value: number }>;
type TerminalStageKey = "CLOSED" | "LOST";
type TerminalOutcomesShape = Record<TerminalStageKey, { count: number; value: number }>;
export type ManagerBreakdownRow = {
  managerId: string;
  managerName: string;
  stages: PipelineShape;
  totalValue: number;
  outcomes: TerminalOutcomesShape;
};

const UNASSIGNED_ROW_ID = "UNASSIGNED";
const UNASSIGNED_ROW_NAME = "Unassigned";

function emptyPipeline() {
  const pipeline: PipelineShape = {
    ACCESS: { count: 0, value: 0 },
    QUALIFIED: { count: 0, value: 0 },
    EVALUATION: { count: 0, value: 0 },
    COMMITTED: { count: 0, value: 0 },
  };
  return pipeline;
}

function accumulatePipeline(
  pipeline: PipelineShape,
  stage: StageKey,
  value: number,
) {
  pipeline[stage].count += 1;
  pipeline[stage].value += value;
}

function emptyTerminalOutcomes(): TerminalOutcomesShape {
  return {
    CLOSED: { count: 0, value: 0 },
    LOST: { count: 0, value: 0 },
  };
}

function isTerminalStage(stage: string): stage is TerminalStageKey {
  return stage === "CLOSED" || stage === "LOST";
}

function isPipelineStage(stage: string): stage is StageKey {
  return stage === "ACCESS" || stage === "QUALIFIED" || stage === "EVALUATION" || stage === "COMMITTED";
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  const url = new URL(request.url);
  const includeRepBreakdown = url.searchParams.get("includeRepBreakdown") === "1";
  const includeOutcomes = url.searchParams.get("includeOutcomes") === "1";
  const product = url.searchParams.get("product");
  if (product && !PRODUCT_OPTIONS.includes(product)) {
    return NextResponse.json({ error: "invalid product" }, { status: 400 });
  }

  let managerReports: Array<{ id: string; name: string; email: string }> = [];
  let managers: Array<{ id: string; name: string }> = [];
  let adminReports: Array<{ id: string; managerId: string | null }> = [];
  const where = {
    ...(await buildDealWhere(user)),
    status: DealStatus.ACTIVE,
    ...(product ? { name: product } : {}),
  };
  if (user.role === UserRole.MANAGER) {
    managerReports = await prisma.user.findMany({
      where: { managerId: user.id, role: UserRole.REP },
      select: { id: true, name: true, email: true },
    });
  } else if (user.role === UserRole.ADMIN) {
    [managers, adminReports] = await Promise.all([
      prisma.user.findMany({
        where: { role: UserRole.MANAGER },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: { role: UserRole.REP },
        select: { id: true, managerId: true },
      }),
    ]);
  }

  const deals = await prisma.deal.findMany({
    where,
    select: {
      id: true,
      value: true,
      lastActivityAt: true,
      status: true,
      account: { select: { assignedToId: true } },
    },
  });
  const activeDeals = getActiveDeals(await enforceExpiry(deals));
  const logs = activeDeals.length
    ? await prisma.interactionLog.findMany({
        where: { dealId: { in: activeDeals.map((deal) => deal.id) } },
        select: { dealId: true, outcome: true },
      })
    : [];
  const logsByDealId = new Map<string, Array<{ outcome: typeof logs[number]["outcome"] }>>();
  for (const log of logs) {
    const arr = logsByDealId.get(log.dealId) ?? [];
    arr.push({ outcome: log.outcome });
    logsByDealId.set(log.dealId, arr);
  }

  const pipeline = emptyPipeline();
  const outcomes = emptyTerminalOutcomes();
  const includePersonalPipeline = user.role === UserRole.MANAGER;
  const personalPipeline = includePersonalPipeline ? emptyPipeline() : null;
  const personalOutcomes = includePersonalPipeline ? emptyTerminalOutcomes() : null;
  const dealStages = activeDeals.map((deal) => ({
    deal,
    stage: getDealStageFromLogs(logsByDealId.get(deal.id) ?? []),
  }));
  dealStages.forEach(({ deal, stage }) => {
    if (personalPipeline && personalOutcomes && deal.account.assignedToId === user.id) {
      if (isPipelineStage(stage)) {
        accumulatePipeline(personalPipeline, stage, deal.value);
      } else if (isTerminalStage(stage)) {
        personalOutcomes[stage].count += 1;
        personalOutcomes[stage].value += deal.value;
      }
    }
    if (isPipelineStage(stage)) {
      accumulatePipeline(pipeline, stage, deal.value);
      return;
    }
    if (!isTerminalStage(stage)) return;
    outcomes[stage].count += 1;
    outcomes[stage].value += deal.value;
  });

  let managerBreakdown: ManagerBreakdownRow[] | undefined;
  if (user.role === UserRole.ADMIN) {
    const assigneeManagerById = new Map<string, string>();
    for (const manager of managers) assigneeManagerById.set(manager.id, manager.id);
    for (const report of adminReports) {
      if (report.managerId) assigneeManagerById.set(report.id, report.managerId);
    }
    const rowsByManager = new Map<string, ManagerBreakdownRow>();
    for (const manager of managers) {
      rowsByManager.set(manager.id, {
        managerId: manager.id,
        managerName: manager.name,
        stages: emptyPipeline(),
        totalValue: 0,
        outcomes: emptyTerminalOutcomes(),
      });
    }
    rowsByManager.set(UNASSIGNED_ROW_ID, {
      managerId: UNASSIGNED_ROW_ID,
      managerName: UNASSIGNED_ROW_NAME,
      stages: emptyPipeline(),
      totalValue: 0,
      outcomes: emptyTerminalOutcomes(),
    });
    for (const { deal, stage } of dealStages) {
      const assignedToId = deal.account.assignedToId;
      const managerId = assignedToId ? assigneeManagerById.get(assignedToId) : undefined;
      const row = rowsByManager.get(managerId ?? UNASSIGNED_ROW_ID);
      if (!row) continue;
      if (isPipelineStage(stage)) {
        accumulatePipeline(row.stages, stage, deal.value);
        row.totalValue += deal.value;
      } else if (isTerminalStage(stage)) {
        row.outcomes[stage].count += 1;
        row.outcomes[stage].value += deal.value;
      }
    }
    managerBreakdown = Array.from(rowsByManager.values());
  }

  if (!(includeRepBreakdown && user.role === UserRole.MANAGER)) {
    if (includeOutcomes) {
      return NextResponse.json({
        pipeline,
        totals: pipeline,
        outcomes,
        ...(managerBreakdown ? { managerBreakdown } : {}),
        ...(personalPipeline && personalOutcomes
          ? {
              personalPipeline: {
                pipeline: personalPipeline,
                outcomes: personalOutcomes,
              },
            }
          : {}),
      });
    }
    return NextResponse.json(pipeline);
  }

  const reportPipelineById = new Map<string, PipelineShape>(
    managerReports.map((report) => [report.id, emptyPipeline()]),
  );
  const reportOutcomesById = new Map<string, TerminalOutcomesShape>(
    managerReports.map((report) => [report.id, emptyTerminalOutcomes()]),
  );
  dealStages.forEach(({ deal, stage }) => {
    const assignedToId = deal.account.assignedToId;
    if (!assignedToId) return;
    if (assignedToId === user.id) {
      return;
    }
    if (isPipelineStage(stage)) {
      const reportPipeline = reportPipelineById.get(assignedToId);
      if (!reportPipeline) return;
      accumulatePipeline(reportPipeline, stage, deal.value);
      return;
    }
    if (!isTerminalStage(stage)) return;
    const reportOutcomes = reportOutcomesById.get(assignedToId);
    if (!reportOutcomes) return;
    reportOutcomes[stage].count += 1;
    reportOutcomes[stage].value += deal.value;
  });

  const repPipelines = managerReports.map((report) => ({
    repId: report.id,
    repName: report.name,
    repEmail: report.email,
    pipeline: reportPipelineById.get(report.id) ?? emptyPipeline(),
    outcomes: reportOutcomesById.get(report.id) ?? emptyTerminalOutcomes(),
  }));

  return NextResponse.json({
    totals: pipeline,
    outcomes,
    repPipelines,
    ...(personalPipeline && personalOutcomes
      ? {
          personalPipeline: {
            pipeline: personalPipeline,
            outcomes: personalOutcomes,
          },
        }
      : {}),
  });
}

