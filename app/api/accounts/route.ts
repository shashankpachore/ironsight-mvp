import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildAccountWhere } from "@/lib/access";
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

  const where = await buildAccountWhere(user);

  const accounts = await prisma.account.findMany({
    where,
    include: {
      assignedTo: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(accounts);
}
