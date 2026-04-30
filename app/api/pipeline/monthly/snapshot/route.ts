import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  generateMonthlySnapshot,
  isValidSnapshotMonth,
  MonthlySnapshotConflictError,
} from "@/lib/pipeline/monthly-snapshot";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "admin access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const month = typeof body === "object" && body && "month" in body ? (body.month as unknown) : null;
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
