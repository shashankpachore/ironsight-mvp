"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TesterUser = {
  id: string;
  email: string;
  role: string;
};

type TesterIdentityContextValue = {
  users: TesterUser[];
  selectedUserId: string;
  currentUser: TesterUser | null;
  switchUser: (userId: string) => void;
  header: Record<string, string>;
};

const STORAGE_KEY = "ironsight_test_user_id";
const TesterIdentityContext = createContext<TesterIdentityContextValue | null>(null);

function getStoredUserId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function TesterIdentityProvider({
  users,
  children,
}: {
  users: TesterUser[];
  children: React.ReactNode;
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>(getStoredUserId);
  const fallbackRep = users.find((user) => user.email === "rep@ironsight.local") ?? null;
  const currentUser =
    users.find((user) => user.id === selectedUserId) ?? (selectedUserId ? null : fallbackRep);

  const value = useMemo<TesterIdentityContextValue>(
    () => {
      return {
        users,
        selectedUserId,
        currentUser,
        switchUser: (userId: string) => {
          setSelectedUserId(userId);
          if (typeof window !== "undefined") {
            if (!userId) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, userId);
          }
        },
        header: {},
      };
    },
    [users, selectedUserId, currentUser],
  );

  return (
    <TesterIdentityContext.Provider value={value}>
      {children}
    </TesterIdentityContext.Provider>
  );
}

export function useTesterIdentity() {
  const value = useContext(TesterIdentityContext);
  if (!value) throw new Error("useTesterIdentity must be used within TesterIdentityProvider");
  return value;
}

export function TesterIdentityBar() {
  const router = useRouter();
  const { users, selectedUserId, currentUser, switchUser } = useTesterIdentity();

  return (
    <div className="border-b bg-gray-50">
      <div className="mx-auto max-w-5xl p-3 flex flex-wrap items-center gap-3 text-sm">
        <p>
          Logged in as:{" "}
          <span className="font-medium">
            {currentUser ? `${currentUser.email} (${currentUser.role})` : "Unknown"}
          </span>
        </p>
        <select
          className="border rounded px-2 py-1"
          value={selectedUserId}
          onChange={(e) => switchUser(e.target.value)}
        >
          <option value="">rep@ironsight.local (REP default)</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email} ({user.role})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => router.refresh()}
        >
          Refresh Data
        </button>
      </div>
    </div>
  );
}
