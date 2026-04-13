"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import { canViewAdminSections } from "@/lib/permissions";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "REP" | "MANAGER" | "ADMIN";
  managerId?: string | null;
};

export default function UsersPageClient() {
  const { currentUser, header } = useTestSession();
  const isAdmin = currentUser?.role === "ADMIN";
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "REP" as "REP" | "MANAGER",
    managerId: "",
  });

  async function loadUsers() {
    setError("");
    const res = await fetch("/api/users", { headers: header });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to load users");
      return;
    }
    setUsers(body);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        managerId: form.role === "REP" ? form.managerId || null : null,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to create user");
      return;
    }
    setForm({
      name: "",
      email: "",
      password: "",
      role: "REP",
      managerId: "",
    });
    await loadUsers();
  }

  async function updateUser(user: UserRow) {
    setError("");
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        role: user.role,
        managerId: user.role === "REP" ? user.managerId ?? null : null,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to update user");
      return;
    }
    await loadUsers();
  }

  async function deleteUser(userId: string) {
    setError("");
    const res = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
      headers: header,
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to delete user");
      return;
    }
    await loadUsers();
  }

  if (!canViewAdminSections(currentUser?.role)) {
    return (
      <main className="mx-auto max-w-5xl p-6 space-y-4">
        <Link href="/" className="underline text-sm">
          Back to deals
        </Link>
        <p className="text-red-600">Access denied.</p>
      </main>
    );
  }

  if (!isAdmin) {
    const managerEmail = (managerId: string | null | undefined) => {
      if (!managerId) return "—";
      return users.find((u) => u.id === managerId)?.email ?? managerId;
    };

    return (
      <main className="mx-auto max-w-5xl p-6 space-y-6">
        <Link href="/" className="underline text-sm">
          Back to deals
        </Link>
        <h1 className="text-2xl font-semibold">Users (read-only)</h1>
        <p className="text-sm text-gray-600">Managers can view users; only admins can create or edit.</p>
        <button
          type="button"
          className="rounded border px-4 py-2 text-sm"
          onClick={() => void loadUsers()}
        >
          Load Users
        </button>
        <section className="border rounded-lg p-4 space-y-2">
          <h2 className="font-medium mb-2">Users</h2>
          {users
            .filter((u) => u.role !== "ADMIN")
            .map((u) => (
              <div key={u.id} className="border rounded p-3 text-sm space-y-1">
                <p>
                  <span className="font-medium">{u.name}</span> ({u.email})
                </p>
                <p>Role: {u.role}</p>
                <p>Manager: {u.role === "REP" ? managerEmail(u.managerId) : "—"}</p>
              </div>
            ))}
          {users.filter((u) => u.role !== "ADMIN").length === 0 ? (
            <p className="text-sm text-gray-600">No users loaded.</p>
          ) : null}
        </section>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </main>
    );
  }

  const managers = users.filter((user) => user.role === "MANAGER");

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <Link href="/" className="underline text-sm">
        Back to deals
      </Link>
      <h1 className="text-2xl font-semibold">User Management</h1>
      <button
        type="button"
        className="rounded border px-4 py-2 text-sm"
        onClick={() => void loadUsers()}
      >
        Load Users
      </button>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Create REP/MANAGER</h2>
        <form className="grid md:grid-cols-2 gap-3" onSubmit={createUser}>
          <input
            className="border rounded px-3 py-2"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <input
            className="border rounded px-3 py-2"
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            required
          />
          <input
            className="border rounded px-3 py-2"
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            required
          />
          <select
            className="border rounded px-3 py-2"
            value={form.role}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, role: e.target.value as "REP" | "MANAGER" }))
            }
          >
            <option value="REP">REP</option>
            <option value="MANAGER">MANAGER</option>
          </select>
          {form.role === "REP" ? (
            <select
              className="border rounded px-3 py-2 md:col-span-2"
              value={form.managerId}
              onChange={(e) => setForm((prev) => ({ ...prev, managerId: e.target.value }))}
            >
              <option value="">No manager</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.email}
                </option>
              ))}
            </select>
          ) : null}
          <button type="submit" className="rounded bg-black text-white px-4 py-2 md:col-span-2">
            Create User
          </button>
        </form>
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Existing REP/MANAGER Users</h2>
        <div className="space-y-3">
          {users
            .filter((user) => user.role !== "ADMIN")
            .map((user) => (
              <div key={user.id} className="border rounded p-3 grid md:grid-cols-5 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  value={user.name}
                  onChange={(e) =>
                    setUsers((prev) =>
                      prev.map((entry) =>
                        entry.id === user.id ? { ...entry, name: e.target.value } : entry,
                      ),
                    )
                  }
                />
                <input
                  className="border rounded px-2 py-1"
                  type="email"
                  value={user.email}
                  onChange={(e) =>
                    setUsers((prev) =>
                      prev.map((entry) =>
                        entry.id === user.id ? { ...entry, email: e.target.value } : entry,
                      ),
                    )
                  }
                />
                <select
                  className="border rounded px-2 py-1"
                  value={user.role}
                  onChange={(e) =>
                    setUsers((prev) =>
                      prev.map((entry) =>
                        entry.id === user.id
                          ? {
                            ...entry,
                            role: e.target.value as UserRow["role"],
                            managerId:
                                e.target.value === "MANAGER" ? null : entry.managerId,
                          }
                          : entry,
                      ),
                    )
                  }
                >
                  <option value="REP">REP</option>
                  <option value="MANAGER">MANAGER</option>
                </select>
                {user.role === "REP" ? (
                  <select
                    className="border rounded px-2 py-1"
                    value={user.managerId ?? ""}
                    onChange={(e) =>
                      setUsers((prev) =>
                        prev.map((entry) =>
                          entry.id === user.id ? { ...entry, managerId: e.target.value || null } : entry,
                        ),
                      )
                    }
                  >
                    <option value="">No manager</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.email}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="border rounded px-3 py-1 text-sm"
                    onClick={() => void updateUser(user)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="border rounded px-3 py-1 text-sm"
                    onClick={() => void deleteUser(user.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          {users.filter((user) => user.role !== "ADMIN").length === 0 ? (
            <p>No users loaded.</p>
          ) : null}
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </main>
  );
}
