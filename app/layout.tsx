import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AppNav } from "@/components/app-nav";
import { AppQueryProvider } from "@/components/query-provider";
import { TestSessionBar, TestSessionProvider } from "@/components/test-session-bar";
import { getCurrentUser, SESSION_COOKIE_NAME } from "@/lib/auth";
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
    ? await getCurrentUser(new Request("http://localhost", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(selectedUserId)}` },
    }))
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppQueryProvider>
          <TestSessionProvider initialCurrentUser={currentUser}>
            <TestSessionBar />
            <AppNav role={currentUser?.role} />
            {children}
          </TestSessionProvider>
        </AppQueryProvider>
      </body>
    </html>
  );
}
