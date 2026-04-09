// SECURITY CRITICAL:
// Do not modify role access without updating tests
import { AccountStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authzError = requireRole(user, [UserRole.ADMIN]);
  if (authzError) return authzError;

  const accounts = await prisma.account.findMany({
    where: { status: AccountStatus.PENDING },
    include: { createdBy: true, assignedTo: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(accounts);
}
