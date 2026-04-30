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

type DealOwnerForValidation = {
  id: string;
  role: UserRole;
};

async function validateCoOwnerId(coOwnerId: unknown, owner: DealOwnerForValidation) {
  if (coOwnerId == null || coOwnerId === "") return null;
  if (typeof coOwnerId !== "string") return "coOwnerId must be a string";
  if (coOwnerId === owner.id) return "coOwnerId cannot equal ownerId";

  const coOwner = await prisma.user.findUnique({
    where: { id: coOwnerId },
    select: { role: true },
  });
  if (!coOwner) return "coOwner not found";
  if (owner.role === UserRole.MANAGER) {
    if (coOwner.role !== UserRole.REP && coOwner.role !== UserRole.MANAGER) {
      return "coOwner must be a REP or MANAGER when owner is MANAGER";
    }
    return null;
  }
  if (coOwner.role !== UserRole.REP) return "coOwner must be a REP when owner is REP";
  return null;
}

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
      owner: { select: { id: true, name: true, email: true, role: true, managerId: true } },
      coOwner: { select: { id: true, name: true } },
    },
  });

  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const [enforcedDeal] = await enforceExpiry([deal]);
  const canRead = await canAccessAssignedToId(user, deal.account.assignedToId);
  const canReadAsOwner = deal.ownerId === user.id || deal.coOwnerId === user.id;
  if (!canRead && !canReadAsOwner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const logs = includeLogs
    ? await prisma.interactionLog.findMany({
        where: { dealId: id },
        include: {
          risks: true,
          participants: {
            include: {
              user: { select: { id: true, name: true, email: true, role: true } },
            },
          },
        },
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

  const body = (await request.json()) as { value?: unknown; coOwnerId?: unknown };
  const hasValue = body.value !== undefined;
  const hasCoOwner = Object.prototype.hasOwnProperty.call(body, "coOwnerId");
  if (!hasValue && !hasCoOwner) {
    return NextResponse.json({ error: "value or coOwnerId is required" }, { status: 400 });
  }
  if (hasValue && (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value <= 0)) {
    return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
  }
  if (hasCoOwner) {
    const ownerUser = await prisma.user.findUnique({
      where: { id: before.ownerId },
      select: { id: true, role: true },
    });
    if (!ownerUser) return NextResponse.json({ error: "owner not found" }, { status: 400 });
    const coOwnerError = await validateCoOwnerId(body.coOwnerId, ownerUser);
    if (coOwnerError) {
      const status = coOwnerError === "coOwner not found" ? 404 : 400;
      return NextResponse.json({ error: coOwnerError }, { status });
    }
  }

  const updated = await prisma.deal.update({
    where: { id },
    data: {
      ...(hasValue ? { value: body.value as number } : {}),
      ...(hasCoOwner ? { coOwnerId: body.coOwnerId ? String(body.coOwnerId) : null } : {}),
    },
  });
  await logAudit({
    entityType: AuditEntityType.DEAL,
    entityId: updated.id,
    action: AuditAction.UPDATE,
    changedById: user.id,
    before: {
      ...(hasValue ? { value: before.value } : {}),
      ...(hasCoOwner ? { coOwnerId: before.coOwnerId } : {}),
    },
    after: {
      ...(hasValue ? { value: updated.value } : {}),
      ...(hasCoOwner ? { coOwnerId: updated.coOwnerId } : {}),
    },
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
