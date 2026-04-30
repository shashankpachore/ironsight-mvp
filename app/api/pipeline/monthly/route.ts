import { NextResponse } from "next/server";
import { GET as getLivePipeline } from "@/app/api/pipeline/route";
import { getCurrentUser } from "@/lib/auth";
import {
  currentSnapshotMonth,
  emptyPipeline,
  emptyTerminalOutcomes,
  getMonthlyPipelineSnapshot,
  isCurrentSnapshotMonth,
  isValidSnapshotMonth,
  PIPELINE_STAGE_KEYS,
  type PipelineShape,
  type TerminalOutcomesShape,
} from "@/lib/pipeline/monthly-snapshot";

type LivePipelineBody = {
  pipeline?: PipelineShape;
  totals?: PipelineShape;
  outcomes?: TerminalOutcomesShape;
  repPipelines?: unknown[];
  managerBreakdown?: unknown[];
  personalPipeline?: unknown;
};

function totalPipelineValue(pipeline: PipelineShape) {
  return PIPELINE_STAGE_KEYS.reduce((sum, stage) => sum + pipeline[stage].value, 0);
}

async function liveMonthlyPipelineResponse(request: Request, month: string) {
  const url = new URL(request.url);
  const liveUrl = new URL("/api/pipeline", url.origin);
  liveUrl.searchParams.set("includeOutcomes", "1");
  liveUrl.searchParams.set("includeRepBreakdown", "1");
  const liveResponse = await getLivePipeline(
    new Request(liveUrl, {
      headers: request.headers,
    }),
  );
  const body = (await liveResponse.json()) as LivePipelineBody;
  const pipeline = body.totals ?? body.pipeline ?? emptyPipeline();
  const outcomes = body.outcomes ?? emptyTerminalOutcomes();

  return NextResponse.json(
    {
      ...body,
      month,
      source: "live",
      totalPipeline: totalPipelineValue(pipeline),
      stageBreakdown: {
        ...pipeline,
        ...outcomes,
      },
      totals: pipeline,
      pipeline,
      outcomes,
      perRepBreakdown: body.repPipelines ?? body.managerBreakdown ?? [],
    },
    { status: liveResponse.status },
  );
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? currentSnapshotMonth();
  if (!isValidSnapshotMonth(month)) {
    return NextResponse.json({ error: "month must use YYYY-MM format" }, { status: 400 });
  }

  if (isCurrentSnapshotMonth(month)) {
    return liveMonthlyPipelineResponse(request, month);
  }

  const snapshot = await getMonthlyPipelineSnapshot(month, user);
  return NextResponse.json(snapshot);
}
