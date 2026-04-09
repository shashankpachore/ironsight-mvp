// SECURITY CRITICAL:
// Do not modify role access without updating tests
import { AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { requireAdmin } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const currentUser = await getCurrentUser(request);
  const authzError = requireAdmin(currentUser);
  if (authzError) return authzError;

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, managerId: true },
    orderBy: { email: "asc" },
  });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser(request);
  const authzError = requireAdmin(currentUser);
  if (authzError) return authzError;

  const body = (await request.json()) as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    managerId?: string | null;
  };

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.email || typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!body.password || typeof body.password !== "string") {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }
  if (!body.role || (body.role !== UserRole.REP && body.role !== UserRole.MANAGER)) {
    return NextResponse.json({ error: "role must be REP or MANAGER" }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const password = await hashPassword(body.password);

  let managerId: string | null = null;
  if (body.role === UserRole.REP) {
    if (body.managerId == null || body.managerId === "") {
      return NextResponse.json({ error: "managerId is required for REP role" }, { status: 400 });
    }
    const manager = await prisma.user.findUnique({ where: { id: body.managerId } });
    if (!manager || manager.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "managerId must reference a MANAGER user" }, { status: 400 });
    }
    managerId = body.managerId;
  }

  const user = await prisma.user.create({
    data: {
      name: body.name.trim(),
      email,
      password,
      role: body.role,
      managerId,
    },
    select: { id: true, name: true, email: true, role: true, managerId: true },
  });

  await logAudit({
    entityType: AuditEntityType.USER,
    entityId: user.id,
    action: AuditAction.CREATE,
    changedById: currentUser!.id,
    before: null,
    after: user,
  });

  return NextResponse.json(user, { status: 201 });
}
