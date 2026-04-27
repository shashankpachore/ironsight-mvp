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
  // #region agent log
  void fetch("http://127.0.0.1:7349/ingest/f75fb91c-b08c-4c55-bcd3-0ea5f9a7c254",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"098dde"},body:JSON.stringify({sessionId:"098dde",runId:"pre-fix",hypothesisId:"H1",location:"lib/auth.ts:28",message:"getCurrentUser entry",data:{testMode:process.env.TEST_MODE==="true",hasCookieHeader:Boolean(request.headers.get("cookie")),hasUserHeader:Boolean(request.headers.get("x-user-id"))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (process.env.TEST_MODE === "true") {
    const headerUserId = request.headers.get("x-user-id");
    if (headerUserId) {
      const headerUser = await prisma.user.findUnique({ where: { id: headerUserId } });
      if (headerUser) {
        // #region agent log
        void fetch("http://127.0.0.1:7349/ingest/f75fb91c-b08c-4c55-bcd3-0ea5f9a7c254",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"098dde"},body:JSON.stringify({sessionId:"098dde",runId:"pre-fix",hypothesisId:"H1",location:"lib/auth.ts:34",message:"getCurrentUser header user resolved",data:{userId:headerUser.id,role:headerUser.role},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return headerUser;
      }
    }
  }

  const cookieUserId = parseCookieValue(request, SESSION_COOKIE_NAME);
  if (!cookieUserId) {
    // #region agent log
    void fetch("http://127.0.0.1:7349/ingest/f75fb91c-b08c-4c55-bcd3-0ea5f9a7c254",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"098dde"},body:JSON.stringify({sessionId:"098dde",runId:"pre-fix",hypothesisId:"H1",location:"lib/auth.ts:42",message:"getCurrentUser missing cookie user id",data:{cookieName:SESSION_COOKIE_NAME},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return null;
  }
  const cookieUser = await prisma.user.findUnique({ where: { id: cookieUserId } });
  // #region agent log
  void fetch("http://127.0.0.1:7349/ingest/f75fb91c-b08c-4c55-bcd3-0ea5f9a7c254",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"098dde"},body:JSON.stringify({sessionId:"098dde",runId:"pre-fix",hypothesisId:"H1",location:"lib/auth.ts:48",message:"getCurrentUser cookie lookup result",data:{cookieUserIdPresent:Boolean(cookieUserId),resolvedUserId:cookieUser?.id??null,role:cookieUser?.role??null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return cookieUser;
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
