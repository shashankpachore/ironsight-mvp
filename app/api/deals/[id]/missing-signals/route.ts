import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "deprecated endpoint. use /api/deals/:id" },
    { status: 410 },
  );
}
