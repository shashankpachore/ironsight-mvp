import { AccountStatus, AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz";
import { getDealStageFromOutcomes } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  const authzError = requireRole(user, [UserRole.ADMIN]);
  if (authzError) return authzError;

  const body = (await request.json()) as { userId?: string };
  if (!body?.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const { id } = await params;
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (account.status !== AccountStatus.APPROVED) {
    return NextResponse.json({ error: "cannot assign unapproved account" }, { status: 400 });
  }

  const assignedUser = await prisma.user.findUnique({ where: { id: body.userId } });
  if (!assignedUser) return NextResponse.json({ error: "assignee not found" }, { status: 404 });

  const { updated, syncedDealCount } = await prisma.$transaction(async (tx) => {
    const updatedAccount = await tx.account.update({
      where: { id },
      data: { assignedToId: body.userId },
      include: { assignedTo: true },
    });

    const deals = await tx.deal.findMany({
      where: { accountId: id },
      select: { id: true },
    });
    const dealIds = deals.map((deal) => deal.id);

    if (dealIds.length === 0) {
      return { updated: updatedAccount, syncedDealCount: 0 };
    }

    const logs = await tx.interactionLog.findMany({
      where: { dealId: { in: dealIds } },
      select: { dealId: true, outcome: true },
    });
    const outcomesByDealId = new Map<string, typeof logs[number]["outcome"][]>();
    for (const log of logs) {
      const existing = outcomesByDealId.get(log.dealId) ?? [];
      existing.push(log.outcome);
      outcomesByDealId.set(log.dealId, existing);
    }

    const activeDealIds: string[] = [];
    for (const deal of deals) {
      const stage = getDealStageFromOutcomes(outcomesByDealId.get(deal.id) ?? []);
      if (stage !== "CLOSED" && stage !== "LOST") {
        activeDealIds.push(deal.id);
      }
    }

    if (activeDealIds.length === 0) {
      return { updated: updatedAccount, syncedDealCount: 0 };
    }

    const syncResult = await tx.deal.updateMany({
      where: { id: { in: activeDealIds } },
      data: { ownerId: body.userId },
    });

    return { updated: updatedAccount, syncedDealCount: syncResult.count };
  });

  await logAudit({
    entityType: AuditEntityType.ACCOUNT,
    entityId: updated.id,
    action: AuditAction.UPDATE,
    changedById: user!.id,
    before: {
      id: account.id,
      assignedToId: account.assignedToId,
      status: account.status,
      name: account.name,
    },
    after: {
      id: updated.id,
      assignedToId: updated.assignedToId,
      status: updated.status,
      name: updated.name,
      syncedDealCount,
    },
  });

  return NextResponse.json(updated);
}
