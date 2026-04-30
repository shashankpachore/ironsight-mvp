import { AccountStatus, AccountType, AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz";
import { validateStateDistrict } from "@/lib/geo/india-states-districts";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  const authzError = requireRole(user, [UserRole.ADMIN]);
  if (authzError) return authzError;

  const { id } = await params;
  const before = await prisma.account.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    type?: AccountType;
    state?: string;
    district?: string;
    status?: AccountStatus;
  };

  const data: {
    name?: string;
    normalized?: string;
    type?: AccountType;
    state?: string;
    district?: string;
    status?: AccountStatus;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
    data.normalized = normalizeCompanyName(body.name);
  }
  if (body.type && Object.values(AccountType).includes(body.type)) data.type = body.type;
  if (typeof body.state === "string" || typeof body.district === "string") {
    const nextState = typeof body.state === "string" ? body.state : before.state;
    const nextDistrict = typeof body.district === "string" ? body.district : before.district;
    if (!nextState || !nextDistrict) {
      return NextResponse.json({ error: "state and district are required" }, { status: 400 });
    }
    const geo = validateStateDistrict(nextState, nextDistrict);
    if (!geo.ok) return NextResponse.json({ error: geo.error }, { status: 400 });
    data.state = geo.state;
    data.district = geo.district;
  }
  if (body.status && Object.values(AccountStatus).includes(body.status)) data.status = body.status;

  const updated = await prisma.account.update({
    where: { id },
    data,
  });

  await logAudit({
    entityType: AuditEntityType.ACCOUNT,
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
  const before = await prisma.account.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "account not found" }, { status: 404 });

  await prisma.account.delete({ where: { id } });
  await logAudit({
    entityType: AuditEntityType.ACCOUNT,
    entityId: before.id,
    action: AuditAction.DELETE,
    changedById: user!.id,
    before,
    after: null,
  });

  return NextResponse.json({ ok: true });
}
