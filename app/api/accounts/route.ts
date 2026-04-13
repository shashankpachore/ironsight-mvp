import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  const url = new URL(request.url);
  const includeAll = url.searchParams.get("includeAll") === "1";

  if (includeAll && user.role === UserRole.REP) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let where = {};
  if (user.role === UserRole.REP) {
    where = { assignedToId: user.id };
  } else if (user.role === UserRole.MANAGER) {
    const reps = await prisma.user.findMany({
      where: { managerId: user.id, role: UserRole.REP },
      select: { id: true },
    });
    const teamIds = [user.id, ...reps.map((rep) => rep.id)];
    where = { assignedToId: { in: teamIds } };
  }

  const accounts = await prisma.account.findMany({
    where,
    include: {
      assignedTo: true,
      requestedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(accounts);
}
