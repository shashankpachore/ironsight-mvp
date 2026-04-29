import { AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { assertDealAccess, canAccessAssignedToId } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz";
import { getDealStageFromLogs, getExpiryWarning, getMissingSignalsFromLogs } from "@/lib/deals";
import { enforceExpiry } from "@/lib/expiry";
import { getDealMomentum } from "@/lib/momentum";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  const includeLogs = new URL(request.url).searchParams.get("includeLogs") === "true";

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      account: true,
    },
  });

  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const [enforcedDeal] = await enforceExpiry([deal]);
  const canRead = await canAccessAssignedToId(user, deal.account.assignedToId);
  if (!canRead) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const logs = includeLogs
    ? await prisma.interactionLog.findMany({
        where: { dealId: id },
        include: { risks: true },
        orderBy: { createdAt: "desc" },
      })
    : await prisma.interactionLog.findMany({
        where: { dealId: id },
        select: { createdAt: true, outcome: true },
        orderBy: { createdAt: "desc" },
      });
  const stage = getDealStageFromLogs(logs);
  const missingSignals = getMissingSignalsFromLogs(enforcedDeal.lastActivityAt, logs);
  const momentum = getDealMomentum(
    { lastActivityAt: enforcedDeal.lastActivityAt, nextStepDate: enforcedDeal.nextStepDate },
    logs.map((log) => ({ createdAt: log.createdAt, outcome: log.outcome })),
  );
  const expiryWarning = getExpiryWarning(momentum.daysSinceLastActivity);

  return NextResponse.json({
    ...enforcedDeal,
    ...(includeLogs ? { logs } : {}),
    stage,
    missingSignals,
    expiryWarning,
    daysToExpiry: expiryWarning === "EXPIRING_SOON" ? 45 - momentum.daysSinceLastActivity : null,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const { id } = await params;
  let before;
  try {
    before = await assertDealAccess(user, id);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_DENIED") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw error;
  }

  const body = (await request.json()) as { value?: unknown };
  if (body.value === undefined) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value <= 0) {
    return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
  }

  const updated = await prisma.deal.update({ where: { id }, data: { value: body.value } });
  await logAudit({
    entityType: AuditEntityType.DEAL,
    entityId: updated.id,
    action: AuditAction.UPDATE,
    changedById: user.id,
    before: { value: before.value },
    after: { value: updated.value },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  const authzError = requireRole(user, [UserRole.ADMIN]);
  if (authzError) return authzError;

  const { id } = await params;
  const before = await prisma.deal.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "deal not found" }, { status: 404 });

  await prisma.deal.delete({ where: { id } });
  await logAudit({
    entityType: AuditEntityType.DEAL,
    entityId: before.id,
    action: AuditAction.DELETE,
    changedById: user!.id,
    before,
    after: null,
  });

  return NextResponse.json({ ok: true });
}
