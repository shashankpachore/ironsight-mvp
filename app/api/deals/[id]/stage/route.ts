import { NextResponse } from "next/server";
import { assertDealAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStage } from "@/lib/deals";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const { id } = await params;
  try {
    await assertDealAccess(user, id);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_DENIED") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw error;
  }

  const stage = await getDealStage(id);
  return NextResponse.json({ stage });
}
