import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AppNav } from "@/components/app-nav";
import { TestSessionBar, TestSessionProvider } from "@/components/test-session-bar";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ironsight MVP",
  description: "Deal tracker MVP",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const selectedUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = selectedUserId
    ? await prisma.user.findUnique({
      where: { id: selectedUserId },
      select: { id: true, email: true, role: true },
    })
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TestSessionProvider initialCurrentUser={currentUser}>
          <TestSessionBar />
          <AppNav role={currentUser?.role} />
          {children}
        </TestSessionProvider>
      </body>
    </html>
  );
}
