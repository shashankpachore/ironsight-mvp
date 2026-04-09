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
  const authzError = requireRole(user, [UserRole.ADMIN]);
  if (authzError) return authzError;

  const { id } = await params;
  const before = await prisma.deal.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "deal not found" }, { status: 404 });

  const body = (await request.json()) as { name?: string; value?: number };
  const data: { name?: string; value?: number } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.value === "number" && body.value > 0) data.value = body.value;

  const updated = await prisma.deal.update({ where: { id }, data });
  await logAudit({
    entityType: AuditEntityType.DEAL,
    entityId: updated.id,
    action: AuditAction.UPDATE,
    changedById: user!.id,
    before,
    after: updated,
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
