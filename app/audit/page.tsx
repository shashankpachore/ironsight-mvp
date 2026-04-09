"use client";

import Link from "next/link";
import { useState } from "react";
import { useTestSession } from "@/components/test-session-bar";

type AuditRow = {
  id: string;
  entityType: string;
  action: string;
  createdAt: string;
  changedBy?: { email: string } | null;
};

export default function AuditPage() {
  const { header, currentUser } = useTestSession();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");

  async function loadAudit() {
    setError("");
    const res = await fetch("/api/audit", { headers: header });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to load audit logs");
      return;
    }
    setRows(body);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/" className="underline">
          Back to deals
        </Link>
        <button type="button" className="underline" onClick={() => void loadAudit()}>
          Load audit logs
        </button>
      </div>

      <h1 className="text-2xl font-semibold">Audit Logs</h1>
      <p className="text-sm">
        Current user:{" "}
        <span className="font-medium">
          {currentUser ? `${currentUser.email} (${currentUser.role})` : "Unknown"}
        </span>
      </p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <table className="w-full border-collapse border text-sm">
        <thead>
          <tr>
            <th className="border p-2 text-left">Entity</th>
            <th className="border p-2 text-left">Action</th>
            <th className="border p-2 text-left">Changed By</th>
            <th className="border p-2 text-left">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="border p-2">{row.entityType}</td>
              <td className="border p-2">{row.action}</td>
              <td className="border p-2">{row.changedBy?.email ?? "-"}</td>
              <td className="border p-2">{new Date(row.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="border p-2" colSpan={4}>
                No logs loaded.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
