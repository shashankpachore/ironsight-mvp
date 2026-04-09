import { NextResponse } from "next/server";
import { Outcome } from "@prisma/client";
import { validateInteractionLogAccess } from "@/lib/account-access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateLogInput, validateOutcomeGuardrails } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const body = await request.json();
  const error = validateLogInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const deal = await prisma.deal.findUnique({
    where: { id: body.dealId },
    include: { account: true },
  });
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  const accessError = validateInteractionLogAccess({
    accountAssignedToId: deal.account.assignedToId,
    currentUserId: user.id,
  });
  if (accessError) {
    const status = accessError === "only assigned user can log interactions" ? 403 : 400;
    return NextResponse.json({ error: accessError }, { status });
  }

  const existingLogs = await prisma.interactionLog.findMany({
    where: { dealId: body.dealId },
    select: { outcome: true },
  });
  const outcomeError = validateOutcomeGuardrails({
    outcome: body.outcome as Outcome,
    dealValue: deal.value,
    existingOutcomes: existingLogs.map((log) => log.outcome),
  });
  if (outcomeError) return NextResponse.json({ error: outcomeError }, { status: 400 });

  const log = await prisma.interactionLog.create({
    data: {
      dealId: body.dealId,
      interactionType: body.interactionType,
      outcome: body.outcome,
      stakeholderType: body.stakeholderType,
      notes: body.notes || null,
      risks: {
        create: body.risks.map((risk: string) => ({ category: risk })),
      },
    },
    include: { risks: true },
  });

  await prisma.deal.update({
    where: { id: body.dealId },
    data: { lastActivityAt: new Date() },
  });

  return NextResponse.json(log, { status: 201 });
}
