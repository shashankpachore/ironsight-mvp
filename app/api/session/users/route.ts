import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "deprecated endpoint. use admin users api" },
    { status: 410 },
  );
}
