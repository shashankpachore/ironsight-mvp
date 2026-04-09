import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "deprecated endpoint. use /api/auth/login" },
    { status: 410 },
  );
}
