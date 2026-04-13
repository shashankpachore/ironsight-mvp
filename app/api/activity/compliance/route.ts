import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getActivityComplianceRows } from "@/lib/activity-compliance";
import { getCurrentUser } from "@/lib/auth";
import { canViewAdminSections } from "@/lib/permissions";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }
  if (user.role === UserRole.REP || !canViewAdminSections(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await getActivityComplianceRows({
    viewer: { id: user.id, role: user.role },
  });

  const body = rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    yesterdayCount: r.yesterdayCount,
    lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
    weeklyActiveDays: r.weeklyActiveDays,
  }));

  return NextResponse.json(body);
}
