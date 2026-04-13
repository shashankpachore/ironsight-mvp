import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { canViewAdminSections } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import AuditPageClient from "./audit-page-client";

export default async function AuditPage() {
  const cookieStore = await cookies();
  const sessionUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = sessionUserId
    ? await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { role: true },
    })
    : null;

  if (!canViewAdminSections(user?.role)) {
    redirect("/");
  }

  return <AuditPageClient />;
}
