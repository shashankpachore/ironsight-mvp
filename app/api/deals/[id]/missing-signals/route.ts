import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMissingSignals } from "@/lib/deals";
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
  if (user.role === UserRole.REP && deal.account.assignedToId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const missingSignals = await getMissingSignals(id);
  return NextResponse.json({ missingSignals });
}
