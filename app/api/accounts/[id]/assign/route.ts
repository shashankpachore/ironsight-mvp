import { AccountStatus, AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  if (!hasRole(user.role, [UserRole.ADMIN, UserRole.MANAGER])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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

  const updated = await prisma.account.update({
    where: { id },
    data: { assignedToId: body.userId },
    include: { assignedTo: true },
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
    },
  });

  return NextResponse.json(updated);
}
