import { NextResponse } from "next/server";
import { Outcome } from "@prisma/client";
import { canAccessAssignedToId } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage, getDealStageFromOutcomes } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: { account: true },
  });
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  const canRead = await canAccessAssignedToId(user, deal.account.assignedToId);
  if (!canRead) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const postOutcome = url.searchParams.get("postOutcome");
  if (postOutcome) {
    if (!Object.values(Outcome).includes(postOutcome as Outcome)) {
      return NextResponse.json({ error: "invalid outcome" }, { status: 400 });
    }
    const existingLogs = await prisma.interactionLog.findMany({
      where: { dealId: id },
      select: { outcome: true },
    });
    const stage = getDealStageFromOutcomes([
      ...existingLogs.map((log) => log.outcome),
      postOutcome as Outcome,
    ]);
    return NextResponse.json({ stage });
  }
  const stage = await getDealStage(id);
  return NextResponse.json({ stage });
}
