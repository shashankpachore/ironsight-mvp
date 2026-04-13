import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireAdminSectionAccess } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authzError = requireAdminSectionAccess(user);
  if (authzError) return authzError;

  const logs = await prisma.auditLog.findMany({
    include: {
      changedBy: { select: { id: true, email: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(logs);
}
