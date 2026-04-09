// SECURITY CRITICAL:
// Do not modify role access without updating tests
import { AccountStatus, AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  const authzError = requireRole(user, [UserRole.ADMIN]);
  if (authzError) return authzError;

  const { id } = await params;
  const before = await prisma.account.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "account not found" }, { status: 404 });
  const account = await prisma.account.update({
    where: { id },
    data: { status: AccountStatus.REJECTED },
  });

  await logAudit({
    entityType: AuditEntityType.ACCOUNT,
    entityId: account.id,
    action: AuditAction.UPDATE,
    changedById: user!.id,
    before: {
      id: before.id,
      status: before.status,
      assignedToId: before.assignedToId,
      name: before.name,
    },
    after: {
      id: account.id,
      status: account.status,
      assignedToId: account.assignedToId,
      name: account.name,
    },
  });

  return NextResponse.json(account);
}
