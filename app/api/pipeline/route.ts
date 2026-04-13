import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

type StageKey = "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED" | "CLOSED";
type PipelineShape = Record<StageKey, { count: number; value: number }>;

function emptyPipeline() {
  const pipeline: PipelineShape = {
    ACCESS: { count: 0, value: 0 },
    QUALIFIED: { count: 0, value: 0 },
    EVALUATION: { count: 0, value: 0 },
    COMMITTED: { count: 0, value: 0 },
    CLOSED: { count: 0, value: 0 },
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

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  const includeRepBreakdown =
    new URL(request.url).searchParams.get("includeRepBreakdown") === "1";

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
  const dealStages = await Promise.all(
    deals.map(async (deal) => ({
      deal,
      stage: (await getDealStage(deal.id)) as StageKey,
    })),
  );
  dealStages.forEach(({ deal, stage }) => {
    accumulatePipeline(pipeline, stage, deal.value);
  });

  if (!(includeRepBreakdown && user.role === UserRole.MANAGER)) {
    return NextResponse.json(pipeline);
  }

  const reportPipelineById = new Map<string, PipelineShape>(
    managerReports.map((report) => [report.id, emptyPipeline()]),
  );
  dealStages.forEach(({ deal, stage }) => {
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
    repPipelines,
  });
}

