import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

type StageKey = "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED";
type PipelineShape = Record<StageKey, { count: number; value: number }>;
type TerminalStageKey = "CLOSED" | "LOST";
type TerminalOutcomesShape = Record<TerminalStageKey, { count: number; value: number }>;

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

  let managerReports: Array<{ id: string; name: string; email: string }> = [];
  const where = await buildDealWhere(user);
  if (user.role === UserRole.MANAGER) {
    managerReports = await prisma.user.findMany({
      where: { managerId: user.id, role: UserRole.REP },
      select: { id: true, name: true, email: true },
    });
  }

  const deals = await prisma.deal.findMany({
    where,
    select: { id: true, value: true, account: { select: { assignedToId: true } } },
  });

  const pipeline = emptyPipeline();
  const outcomes = emptyTerminalOutcomes();
  const dealStages = await Promise.all(
    deals.map(async (deal) => ({
      deal,
      stage: await getDealStage(deal.id),
    })),
  );
  dealStages.forEach(({ deal, stage }) => {
    if (isPipelineStage(stage)) {
      accumulatePipeline(pipeline, stage, deal.value);
      return;
    }
    if (!isTerminalStage(stage)) return;
    outcomes[stage].count += 1;
    outcomes[stage].value += deal.value;
  });

  if (!(includeRepBreakdown && user.role === UserRole.MANAGER)) {
    if (includeOutcomes) {
      return NextResponse.json({ totals: pipeline, outcomes });
    }
    return NextResponse.json(pipeline);
  }

  const reportPipelineById = new Map<string, PipelineShape>(
    managerReports.map((report) => [report.id, emptyPipeline()]),
  );
  dealStages.forEach(({ deal, stage }) => {
    if (!isPipelineStage(stage)) return;
    const assignedToId = deal.account.assignedToId;
    if (!assignedToId) return;
    const reportPipeline = reportPipelineById.get(assignedToId);
    if (!reportPipeline) return;
    accumulatePipeline(reportPipeline, stage, deal.value);
  });

  const repPipelines = managerReports.map((report) => ({
    repId: report.id,
    repName: report.name,
    repEmail: report.email,
    pipeline: reportPipelineById.get(report.id) ?? emptyPipeline(),
  }));

  return NextResponse.json({
    totals: pipeline,
    outcomes,
    repPipelines,
  });
}

