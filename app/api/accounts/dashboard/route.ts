import { AccountStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildAccountWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { canViewAdminSections } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const [accounts, users, pending] = await Promise.all([
    prisma.account.findMany({
      where: await buildAccountWhere(user),
      include: {
        assignedTo: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    canViewAdminSections(user.role)
      ? prisma.user.findMany({
          select: { id: true, name: true, email: true, role: true, managerId: true },
          orderBy: { email: "asc" },
        })
      : Promise.resolve([]),
    user.role === UserRole.ADMIN
      ? prisma.account.findMany({
          where: { status: AccountStatus.PENDING },
          include: {
            createdBy: true,
            assignedTo: true,
            requestedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ accounts, users, pending });
}
