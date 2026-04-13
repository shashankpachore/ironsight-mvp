import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { canViewAdminSections } from "@/lib/permissions";

type UserLike = { role: UserRole } | null;

export function requireRole(user: UserLike, allowedRoles: UserRole[]) {
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export function requireAdmin(user: UserLike) {
  return requireRole(user, [UserRole.ADMIN]);
}

export function requireAdminSectionAccess(user: UserLike) {
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }
  if (!canViewAdminSections(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
