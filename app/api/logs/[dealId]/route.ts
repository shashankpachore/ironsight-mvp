import { NextResponse } from "next/server";
import { canAccessAssignedToId } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { enforceExpiry } from "@/lib/expiry";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const { dealId } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { account: true },
  });
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  await enforceExpiry([deal]);
  const canRead = await canAccessAssignedToId(user, deal.account.assignedToId);
  if (!canRead) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const logs = await prisma.interactionLog.findMany({
    where: { dealId },
    include: { risks: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    logs.map((log) => ({
      ...log,
      risks: log.risks.map((risk) => risk.category),
    })),
  );
}
