import { NextResponse } from "next/server";
import { canAccessAssignedToId } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage } from "@/lib/deals";
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
  const stage = await getDealStage(id);
  return NextResponse.json({ stage });
}
