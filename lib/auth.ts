import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "./prisma";

export const SESSION_COOKIE_NAME = "ironsight_user_id";
const BCRYPT_ROUNDS = 10;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

export function parseCookieValue(request: Request, key: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rest] = cookie.trim().split("=");
    if (rawName !== key) continue;
    return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getCurrentUser(request: Request) {
  if (process.env.TEST_MODE === "true") {
    const headerUserId = request.headers.get("x-user-id");
    if (headerUserId) {
      const headerUser = await prisma.user.findUnique({ where: { id: headerUserId } });
      if (headerUser) return headerUser;
    }
  }

  const cookieUserId = parseCookieValue(request, SESSION_COOKIE_NAME);
  if (!cookieUserId) return null;
  return prisma.user.findUnique({ where: { id: cookieUserId } });
}

export function hasRole(role: UserRole, allowed: UserRole[]) {
  return allowed.includes(role);
}

export async function hashPassword(plainPassword: string) {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, storedPassword: string) {
  if (!storedPassword.startsWith("$2")) {
    // Backward-compatible fallback for legacy plain text rows.
    return plainPassword === storedPassword;
  }
  return bcrypt.compare(plainPassword, storedPassword);
}
