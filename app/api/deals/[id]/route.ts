import { AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz";
import { getDealStage, getMissingSignals } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser(_request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      account: true,
      logs: {
        include: { risks: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (user.role === UserRole.REP && deal.account.assignedToId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [stage, missingSignals] = await Promise.all([
    getDealStage(id),
    getMissingSignals(id),
  ]);

  return NextResponse.json({ ...deal, stage, missingSignals });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const { id } = await params;
  const before = await prisma.deal.findUnique({
    where: { id },
    select: {
      id: true,
      value: true,
      ownerId: true,
      owner: { select: { managerId: true } },
    },
  });
  if (!before) return NextResponse.json({ error: "deal not found" }, { status: 404 });

  const canEdit =
    user.role === UserRole.ADMIN ||
    before.ownerId === user.id ||
    (user.role === UserRole.MANAGER && before.owner.managerId === user.id);
  if (!canEdit) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
