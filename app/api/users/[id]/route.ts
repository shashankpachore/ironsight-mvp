import { AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, hasRole, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) return NextResponse.json({ error: "user not found" }, { status: 401 });
  if (!hasRole(currentUser.role, [UserRole.ADMIN])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (existing.role === UserRole.ADMIN) {
    return NextResponse.json({ error: "admin users cannot be modified here" }, { status: 400 });
  }

  const body = (await request.json()) as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    managerId?: string | null;
  };

  const data: {
    name?: string;
    email?: string;
    password?: string;
    role?: UserRole;
    managerId?: string | null;
  } = {};

  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.email === "string") data.email = body.email.trim().toLowerCase();
  if (typeof body.password === "string" && body.password.length > 0) {
    data.password = await hashPassword(body.password);
  }
  if (typeof body.role === "string") {
    if (body.role !== UserRole.REP && body.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "role must be REP or MANAGER" }, { status: 400 });
    }
    data.role = body.role;
  }

  const nextRole = data.role ?? existing.role;
  if (nextRole === UserRole.MANAGER) {
    data.managerId = null;
  } else {
    const effectiveManagerId =
      body.managerId !== undefined
        ? body.managerId === null || body.managerId === ""
          ? null
          : body.managerId
        : existing.managerId;

    if (!effectiveManagerId) {
      return NextResponse.json({ error: "managerId is required for REP role" }, { status: 400 });
    }

    const manager = await prisma.user.findUnique({ where: { id: effectiveManagerId } });
    if (!manager || manager.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "managerId must reference a MANAGER user" }, { status: 400 });
    }

    if (body.managerId !== undefined) {
      data.managerId =
        body.managerId === null || body.managerId === "" ? null : body.managerId;
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, managerId: true },
  });

  await logAudit({
    entityType: AuditEntityType.USER,
    entityId: updated.id,
    action: AuditAction.UPDATE,
    changedById: currentUser.id,
    before: {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      role: existing.role,
      managerId: existing.managerId,
    },
    after: updated,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) return NextResponse.json({ error: "user not found" }, { status: 401 });
  if (!hasRole(currentUser.role, [UserRole.ADMIN])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === currentUser.id) {
    return NextResponse.json({ error: "cannot delete current admin user" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (existing.role === UserRole.ADMIN) {
    return NextResponse.json({ error: "admin users cannot be deleted here" }, { status: 400 });
  }

  const deps = await prisma.user.findUnique({
    where: { id },
    select: {
      _count: {
        select: {
          deals: true,
          createdAccounts: true,
          assignedAccounts: true,
          reports: true,
        },
      },
    },
  });
  const totalDependencies =
    (deps?._count.deals ?? 0) +
    (deps?._count.createdAccounts ?? 0) +
    (deps?._count.assignedAccounts ?? 0) +
    (deps?._count.reports ?? 0);
  if (totalDependencies > 0) {
    return NextResponse.json(
      { error: "cannot delete user with dependent records" },
      { status: 409 },
    );
  }

  await prisma.user.delete({ where: { id } });
  await logAudit({
    entityType: AuditEntityType.USER,
    entityId: existing.id,
    action: AuditAction.DELETE,
    changedById: currentUser.id,
    before: {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      role: existing.role,
      managerId: existing.managerId,
    },
    after: null,
  });
  return NextResponse.json({ ok: true });
}
