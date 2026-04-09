"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";

type User = { id: string; email: string; role: string };
type Account = {
  id: string;
  name: string;
  type?: "SCHOOL" | "PARTNER";
  state?: string;
  district?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  assignedToId: string | null;
  assignedTo?: { email: string } | null;
};

type ImportPreviewRow = {
  rowNumber: number;
  name: string;
  type: "SCHOOL" | "PARTNER";
  state: string;
  district: string;
  duplicateInFile: boolean;
  duplicateInDb: boolean;
  errors: string[];
};

export default function AccountsPage() {
  const { header, currentUser } = useTestSession();
  const isRep = currentUser?.role === "REP";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pending, setPending] = useState<Account[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [assignUserByAccount, setAssignUserByAccount] = useState<Record<string, string>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importSummary, setImportSummary] = useState("");

  async function loadAll() {
    const accountsUrl = isRep ? "/api/accounts" : "/api/accounts?includeAll=1";
    const [accountsRes, pendingRes, usersRes] = await Promise.all([
      fetch(accountsUrl, { headers: header }),
      fetch("/api/accounts/pending", { headers: header }),
      fetch("/api/users", { headers: header }),
    ]);
    if (accountsRes.ok) setAccounts(await accountsRes.json());
    if (pendingRes.ok) setPending(await pendingRes.json());
    if (usersRes.ok) setUsers(await usersRes.json());
  }

  async function requestAccount(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/accounts/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Request failed");
      return;
    }
    setName("");
    await loadAll();
  }

  async function approve(id: string) {
    await fetch(`/api/accounts/${id}/approve`, {
      method: "POST",
      headers: header,
    });
    await loadAll();
  }

  async function reject(id: string) {
    await fetch(`/api/accounts/${id}/reject`, {
      method: "POST",
      headers: header,
    });
    await loadAll();
  }

  async function assign(id: string) {
    const selectedUserId = assignUserByAccount[id];
    if (!selectedUserId) return;
    await fetch(`/api/accounts/${id}/assign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({ userId: selectedUserId }),
    });
    await loadAll();
  }

  async function exportData() {
    const res = await fetch("/api/export", {
      headers: header,
    });
    if (!res.ok) {
      setError("Export failed or forbidden for current user");
      return;
    }
    const csv = await res.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ironsight-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function previewImport() {
    if (!importFile) {
      setError("Please select a CSV file first");
      return;
    }
    setError("");
    const formData = new FormData();
    formData.append("file", importFile);
    const res = await fetch("/api/accounts/import?mode=preview", {
      method: "POST",
      headers: header,
      body: formData,
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Preview failed");
      return;
    }
    setImportPreview(body.rows ?? []);
    setImportSummary(`Rows: ${body.totalRows} | Valid: ${body.validRows}`);
  }

  async function confirmImport() {
    if (!importFile) {
      setError("Please select a CSV file first");
      return;
    }
    setError("");
    const formData = new FormData();
    formData.append("file", importFile);
    const res = await fetch("/api/accounts/import?mode=confirm", {
      method: "POST",
      headers: header,
      body: formData,
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Import failed");
      return;
    }
    setImportSummary(`Imported: ${body.imported} | Skipped: ${body.skipped}`);
    await loadAll();
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <Link href="/" className="underline text-sm">
        Back to deals
      </Link>
      <h1 className="text-2xl font-semibold">Accounts</h1>
      <p className="text-sm">
        Current tester identity:{" "}
        <span className="font-medium">
          {currentUser ? `${currentUser.email} (${currentUser.role})` : "REP default"}
        </span>
      </p>
      <button
        type="button"
        className="rounded border px-4 py-2 text-sm"
        onClick={exportData}
      >
        Export Data
      </button>

      <section className="border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">Import Accounts CSV</h2>
        <p className="text-sm text-gray-600">
          Supported columns: School Name, State, District OR Partner Name, State, District.
        </p>
        <div className="flex items-center gap-3">
          <label
            htmlFor="accounts-csv-upload"
            className="cursor-pointer rounded border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Choose CSV File
          </label>
          <span className="text-sm text-gray-700">
            {importFile ? importFile.name : "No file chosen"}
          </span>
          <input
            id="accounts-csv-upload"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className="rounded border px-4 py-2 text-sm" onClick={() => void previewImport()}>
            Preview Import
          </button>
          <button type="button" className="rounded border px-4 py-2 text-sm" onClick={() => void confirmImport()}>
            Confirm Import
          </button>
        </div>
        {importSummary ? <p className="text-sm">{importSummary}</p> : null}
        {importPreview.length > 0 ? (
          <div className="border rounded p-3 max-h-60 overflow-auto text-sm space-y-1">
            {importPreview.map((row) => (
              <p key={row.rowNumber}>
                Row {row.rowNumber}: {row.name} ({row.type}) - {row.state}/{row.district}
                {row.duplicateInDb ? " | duplicate in DB" : ""}
                {row.duplicateInFile ? " | duplicate in file" : ""}
                {row.errors.length ? ` | ${row.errors.join(", ")}` : ""}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <button
        type="button"
        className="rounded border px-4 py-2 text-sm"
        onClick={() => void loadAll()}
      >
        Load Accounts
      </button>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Request Account</h2>
        <form onSubmit={requestAccount} className="flex gap-2">
          <input
            className="border rounded px-3 py-2 flex-1"
            placeholder="Account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="rounded bg-black text-white px-4 py-2">Request Account</button>
        </form>
        {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">All Visible Accounts</h2>
        <div className="space-y-2">
          {accounts.map((account) => (
            <div key={account.id} className="border rounded p-3 space-y-2">
              <p>{account.name}</p>
              <p className="text-sm">Type: {account.type ?? "-"}</p>
              <p className="text-sm">Location: {account.state ?? "-"} / {account.district ?? "-"}</p>
              <p className="text-sm">Status: {account.status}</p>
              <p className="text-sm">Assigned: {account.assignedTo?.email ?? "Unassigned"}</p>
              {account.status === "APPROVED" ? (
                <div className={`flex gap-2 ${isRep ? "opacity-60" : ""}`}>
                  <select
                    className={`border rounded px-2 py-1 text-sm ${isRep ? "cursor-not-allowed" : ""}`}
                    value={assignUserByAccount[account.id] ?? ""}
                    disabled={isRep}
                    onChange={(e) =>
                      setAssignUserByAccount((prev) => ({
                        ...prev,
                        [account.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Assign user</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.email} ({user.role})
                      </option>
                    ))}
                  </select>
                  <button
                    className={`rounded border px-3 py-1 text-sm ${isRep ? "cursor-not-allowed" : ""}`}
                    type="button"
                    disabled={isRep}
                    onClick={() => assign(account.id)}
                  >
                    Assign
                  </button>
                  {isRep ? (
                    <p className="text-xs text-gray-600 self-center">
                      Only Admin/Manager can assign accounts
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {accounts.length === 0 ? <p>No accounts visible.</p> : null}
        </div>
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Pending Accounts (Admin)</h2>
        <div className="space-y-2">
          {pending.map((account) => (
            <div key={account.id} className="border rounded p-3 flex items-center justify-between">
              <p>{account.name}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => approve(account.id)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => reject(account.id)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {pending.length === 0 ? <p>No pending accounts.</p> : null}
        </div>
      </section>
    </main>
  );
}
