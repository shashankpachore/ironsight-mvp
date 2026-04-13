import { UserRole } from "@prisma/client";

/** Accepts `UserRole` or plain strings from session/UI (values match enum). */
export function canViewAdminSections(role: UserRole | string | null | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}
