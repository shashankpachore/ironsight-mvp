import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email.trim().toLowerCase() },
  });
  if (!user) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

  const isValid = await verifyPassword(body.password, user.password);
  if (!isValid) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

  const response = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  response.cookies.set(SESSION_COOKIE_NAME, user.id, SESSION_COOKIE_OPTIONS);
  return response;
}
