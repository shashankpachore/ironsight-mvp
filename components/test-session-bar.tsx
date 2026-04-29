"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SessionUser = {
  id: string;
  name?: string;
  email: string;
  role: string;
};

type SessionContextValue = {
  currentUser: SessionUser | null;
  header: Record<string, string>;
  sessionError: string;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function TestSessionProvider({
  children,
  initialCurrentUser,
}: {
  children: React.ReactNode;
  initialCurrentUser: SessionUser | null;
}) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(initialCurrentUser);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      setCurrentUser(initialCurrentUser);
    });
  }, [initialCurrentUser]);

  async function logout() {
    setSessionError("");
    const logoutRes = await fetch("/api/auth/logout", {
      method: "POST",
    });
    if (!logoutRes.ok) {
      setSessionError("Failed to logout");
      return;
    }

    setCurrentUser(null);
    router.push("/login");
    router.refresh();
  }

  const header = useMemo<Record<string, string>>(() => ({}), []);
  const value: SessionContextValue = { currentUser, header, sessionError, logout };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useTestSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useTestSession must be used inside TestSessionProvider");
  return value;
}

export function TestSessionBar() {
  const { currentUser, sessionError, logout } = useTestSession();

  if (!currentUser) {
    return (
      <div className="border-b bg-gray-50">
        <div className="mx-auto max-w-5xl p-3 flex flex-wrap items-center gap-3 text-sm">
          <p className="text-red-600">Session expired or invalid.</p>
          <Link href="/login" className="border rounded px-2 py-1">
            Go to login
          </Link>
          <button
            type="button"
            className="border rounded px-2 py-1"
            onClick={() => void logout()}
          >
            Clear session
          </button>
          {sessionError ? <p className="text-red-600">{sessionError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b bg-gray-50">
      <div className="mx-auto max-w-5xl p-3 flex flex-wrap items-center gap-3 text-sm">
        <p>
          Logged in as{" "}
          <span className="font-medium">
            {`${currentUser.email} (${currentUser.role})`}
          </span>
        </p>
        <button
          type="button"
          className="border rounded px-2 py-1"
          onClick={() => void logout()}
        >
          Logout
        </button>
        {sessionError ? <p className="text-red-600">{sessionError}</p> : null}
      </div>
    </div>
  );
}
