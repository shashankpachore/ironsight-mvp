import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type LoginErrorBody = {
  ok: false;
  error: string;
  code: string;
  detail?: string;
};

function loginError(body: LoginErrorBody, status: number) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return loginError(
      {
        ok: false,
        code: "INVALID_JSON",
        error: "Request body was not valid JSON.",
      },
      400,
    );
  }

  if (!body?.email || !body?.password) {
    return loginError(
      {
        ok: false,
        code: "VALIDATION",
        error: "Email and password are required.",
      },
      400,
    );
  }

  const email = body.email.trim().toLowerCase();

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return loginError(
        {
          ok: false,
          code: "USER_NOT_FOUND",
          error: "No user exists in the database for this email.",
          detail:
            "If this is a new environment, run database migrations and seed (for example: npx prisma migrate deploy && npm run seed).",
        },
        401,
      );
    }

    const isValid = await verifyPassword(body.password, user.password);
    if (!isValid) {
      return loginError(
        {
          ok: false,
          code: "PASSWORD_MISMATCH",
          error: "The password does not match the stored hash for this user.",
        },
        401,
      );
    }

    const response = NextResponse.json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
    response.cookies.set(SESSION_COOKIE_NAME, user.id, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return loginError(
        {
          ok: false,
          code: `PRISMA_${e.code}`,
          error: "Database query failed while signing in.",
          detail: `${e.code}: ${e.message}`,
        },
        503,
      );
    }
    if (e instanceof Prisma.PrismaClientInitializationError) {
      return loginError(
        {
          ok: false,
          code: "DATABASE_INIT",
          error: "Could not connect to the database (initialization failed).",
          detail: e.message,
        },
        503,
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    return loginError(
      {
        ok: false,
        code: "UNKNOWN",
        error: "Unexpected error during login.",
        detail: message,
      },
      500,
    );
  }
}
