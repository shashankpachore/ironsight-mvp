import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  generateMonthlySnapshot,
  isValidSnapshotMonth,
  MonthlySnapshotConflictError,
  previousSnapshotMonth,
} from "@/lib/pipeline/monthly-snapshot";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const isCron =
    process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

  let user = null;
  if (!isCron) {
    user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
    if (user.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: "admin access required" }, { status: 403 });
    }
  }

  let body: any = null;
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let month =
    typeof body === "object" && body && "month" in body ? (body.month as unknown) : null;

  if (!month && isCron) {
    month = previousSnapshotMonth();
  }

  if (typeof month !== "string" || !isValidSnapshotMonth(month)) {
    return NextResponse.json({ error: "month must use YYYY-MM format" }, { status: 400 });
  }

  try {
    const result = await generateMonthlySnapshot(month);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof MonthlySnapshotConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
