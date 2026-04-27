import { NextResponse } from "next/server";
import { getAccessibleUserIds } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { requireAdminSectionAccess } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authzError = requireAdminSectionAccess(user);
  if (authzError) return authzError;

  const accessibleUserIds = await getAccessibleUserIds(user);
  const logs = await prisma.auditLog.findMany({
    where: accessibleUserIds ? { changedById: { in: accessibleUserIds } } : undefined,
    include: {
      changedBy: { select: { id: true, email: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(logs);
}
