import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const selectedUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = selectedUserId
    ? await prisma.user.findUnique({
        where: { id: selectedUserId },
        select: { id: true },
      })
    : null;

  if (user) {
    redirect("/");
  }

  return <LoginForm />;
}
