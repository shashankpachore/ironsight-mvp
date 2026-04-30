"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import { DISTRICTS_BY_STATE, STATES, type IndiaState } from "@/lib/geo/india-states-districts";

type User = { id: string; email: string; role: string };
type Account = {
  id: string;
  name: string;
  type?: "SCHOOL" | "PARTNER";
  normalized?: string;
  state?: string;
  district?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedById?: string | null;
  requestedBy?: { id: string; name: string; role: string } | null;
  assignedToId: string | null;
  assignedTo?: { id: string; name: string } | null;
};

type ImportPreviewRow = {
  row: number;
  rowNumber: number;
  name: string;
  type: "SCHOOL" | "PARTNER";
  state: string;
  district: string;
  input?: { state: string; district: string };
  status?: "accepted" | "corrected" | "needs_review" | "rejected";
  confidence?: "high" | "medium" | "low";
  corrected?: { state: string; district: string };
  suggestions?: string[];
  stateSuggestions?: string[];
  districtSuggestions?: string[];
  duplicateInFile: boolean;
  duplicateInDb: boolean;
  errors: string[];
};

type ImportSummary = {
  accepted: number;
  corrected: number;
  needsReview: number;
  rejected: number;
};

function formatAccountType(type: string | undefined) {
  if (type === "PARTNER") return "Partner";
  if (type === "SCHOOL") return "School";
  return type ?? "—";
}

function formatAccountStatus(account: Account) {
  if (account.status === "PENDING") return "Pending Approval";
  if (account.status === "REJECTED") return "Rejected";
  if (account.assignedToId) return "Assigned";
  if (account.status === "APPROVED") return "Approved (Not Assigned)";
  return account.status;
}

export default function AccountsPage() {
  const { header, currentUser } = useTestSession();
  const queryClient = useQueryClient();
  const isAdmin = currentUser?.role === "ADMIN";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pending, setPending] = useState<Account[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [requestType, setRequestType] = useState<"SCHOOL" | "PARTNER">("SCHOOL");
  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [requestState, setRequestState] = useState("");
  const [error, setError] = useState("");
  const [assignUserByAccount, setAssignUserByAccount] = useState<Record<string, string>>({});
  const [importFile, setImportFile] = useState<File | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setAssignUserByAccount((prev) => {
        const next = { ...prev };
        for (const a of accounts) {
          if (a.status !== "APPROVED") continue;
          if (a.id in next) continue;
          if (a.requestedBy?.role === "REP" && a.requestedById) {
            next[a.id] = a.requestedById;
          }
        }
        return next;
      });
    });
  }, [accounts]);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importSummary, setImportSummary] = useState("");
  const [importStatusSummary, setImportStatusSummary] = useState<ImportSummary | null>(null);
  const [approvedCorrections, setApprovedCorrections] = useState<Record<number, boolean>>({});
  const [manualFixes, setManualFixes] = useState<Record<number, { state: string; district: string }>>({});
  const [searchQuery, setSearchQuery] = useState("");

  async function loadAll() {
    const res = await fetch("/api/accounts/dashboard", { headers: header });
    if (!res.ok) return;
    const body = (await res.json()) as {
      accounts?: Account[];
      users?: User[];
      pending?: Account[];
    };
    setAccounts(body.accounts ?? []);
    setUsers(body.users ?? []);
    setPending(isAdmin ? body.pending ?? [] : []);
  }

  async function requestAccount(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!requestState.trim()) {
      setError("State is required");
      return;
    }
    const res = await fetch("/api/accounts/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({
        type: requestType,
        name: name.trim(),
        district: district.trim(),
        state: requestState.trim(),
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Request failed");
      return;
    }
    setName("");
    setDistrict("");
    setRequestState("");
    setRequestType("SCHOOL");
    await loadAll();
  }

  async function approve(id: string) {
    const res = await fetch(`/api/accounts/${id}/approve`, {
      method: "POST",
      headers: header,
    });
    if (!res.ok) return;
    const updated = (await res.json()) as Account;
    setAccounts((prev) => prev.map((account) => (account.id === id ? { ...account, ...updated } : account)));
    setPending((prev) => prev.filter((account) => account.id !== id));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["accountsPending"] }),
    ]);
  }

  async function reject(id: string) {
    const res = await fetch(`/api/accounts/${id}/reject`, {
      method: "POST",
      headers: header,
    });
    if (!res.ok) return;
    const updated = (await res.json()) as Account;
    setAccounts((prev) => prev.map((account) => (account.id === id ? { ...account, ...updated } : account)));
    setPending((prev) => prev.filter((account) => account.id !== id));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["accountsPending"] }),
    ]);
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
      body: formData,
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Preview failed");
      return;
    }
    setImportPreview(body.rows ?? []);
    setImportStatusSummary(body.summary ?? null);
    setApprovedCorrections({});
    setManualFixes({});
    setImportSummary(`Rows: ${body.totalRows} | Valid: ${body.validRows} | Failed: ${body.failedRows?.length ?? 0}`);
  }

  async function confirmImport() {
    if (!importFile) {
      setError("Please select a CSV file first");
      return;
    }
    setError("");
    const formData = new FormData();
    formData.append("file", importFile);
    formData.append(
      "approvedCorrections",
      JSON.stringify(
        Object.entries(approvedCorrections)
          .filter(([, approved]) => approved)
          .map(([row]) => Number(row)),
      ),
    );
    formData.append("manualFixes", JSON.stringify(manualFixes));
    const res = await fetch("/api/accounts/import?mode=confirm", {
      method: "POST",
      body: formData,
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Import failed");
      return;
    }
    setImportPreview(body.rows ?? []);
    setImportStatusSummary(body.summary ?? null);
    setImportSummary(`Imported: ${body.successCount ?? body.imported} | Failed: ${body.failedRows?.length ?? 0}`);
    await loadAll();
  }

  function updateManualFix(rowNumber: number, patch: Partial<{ state: string; district: string }>) {
    setManualFixes((prev) => {
      const current = prev[rowNumber] ?? { state: "", district: "" };
      const next = { ...current, ...patch };
      if ("state" in patch) next.district = "";
      return { ...prev, [rowNumber]: next };
    });
  }

  const nameLabel = requestType === "PARTNER" ? "Partner Name" : "School Name";
  const selectedState = STATES.includes(requestState as IndiaState) ? (requestState as IndiaState) : null;
  const districtOptions = selectedState ? DISTRICTS_BY_STATE[selectedState] : [];
  const formValid =
    requestType && name.trim().length > 0 && district.trim().length > 0 && requestState.trim().length > 0;
  const needsAssignment = [...accounts].filter(
    (account) => account.status === "APPROVED" && !account.assignedToId,
  );
  const searchQueryNormalized = searchQuery.trim().toLowerCase();
  const searchEnabled = searchQueryNormalized.length >= 2;
  const searchResults = searchEnabled
    ? accounts
        .filter((account) => {
          const nameMatch = account.name.toLowerCase().includes(searchQueryNormalized);
          const normalizedMatch = (account.normalized ?? "").includes(searchQueryNormalized);
          return nameMatch || normalizedMatch;
        })
        .slice(0, 25)
    : [];
  const myPendingAccounts = accounts.filter((account) => account.status === "PENDING");
  const myApprovedAccounts = accounts.filter(
    (account) => account.status === "APPROVED" && !account.assignedToId,
  );
  const myAssignedAccounts = accounts.filter(
    (account) => account.status === "APPROVED" && !!account.assignedToId,
  );

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
          Same fields as manual request: School Name or Partner Name, State, District (CSV columns).
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
        {importStatusSummary ? (
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <div className="rounded border border-green-200 bg-green-50 p-2">
              ✅ accepted: {importStatusSummary.accepted}
            </div>
            <div className="rounded border border-yellow-200 bg-yellow-50 p-2">
              ⚠ corrected: {importStatusSummary.corrected}
            </div>
            <div className="rounded border border-blue-200 bg-blue-50 p-2">
              🔍 needs review: {importStatusSummary.needsReview}
            </div>
            <div className="rounded border border-red-200 bg-red-50 p-2">
              ❌ rejected: {importStatusSummary.rejected}
            </div>
          </div>
        ) : null}
        {importPreview.length > 0 ? (
          <div className="border rounded p-3 max-h-80 overflow-auto text-sm space-y-3">
            {importPreview.map((row) => {
              const rowNumber = row.rowNumber ?? row.row;
              const fix = manualFixes[rowNumber] ?? { state: "", district: "" };
              const fixState = STATES.includes(fix.state as IndiaState) ? (fix.state as IndiaState) : null;
              const fixDistrictOptions = fixState ? DISTRICTS_BY_STATE[fixState] : [];

              return (
                <div key={rowNumber} className="rounded border p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        Row {rowNumber}: {row.name} ({row.type})
                      </p>
                      <p className="text-gray-700">
                        Input: {row.input?.state ?? row.state}/{row.input?.district ?? row.district}
                      </p>
                      <p className="text-gray-700">
                        Status: {row.status ?? (row.errors.length ? "rejected" : "accepted")}
                        {row.confidence ? ` (${row.confidence} confidence)` : ""}
                      </p>
                    </div>
                    {row.status === "corrected" && row.corrected ? (
                      <label className="flex items-center gap-2 rounded border px-2 py-1">
                        <input
                          type="checkbox"
                          checked={approvedCorrections[rowNumber] ?? false}
                          onChange={(e) =>
                            setApprovedCorrections((prev) => ({
                              ...prev,
                              [rowNumber]: e.target.checked,
                            }))
                          }
                        />
                        Approve correction
                      </label>
                    ) : null}
                  </div>

                  {row.status === "corrected" && row.corrected ? (
                    <p className="text-yellow-800">
                      Suggested correction: {row.input?.state}/{row.input?.district} → {row.corrected.state}/
                      {row.corrected.district}
                    </p>
                  ) : null}

                  {row.status === "needs_review" ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="mb-1 text-gray-700">
                          Suggestions: {(row.suggestions ?? []).join(", ") || "No close match"}
                        </p>
                        <select
                          className="border rounded px-2 py-1 w-full"
                          value={fix.state}
                          onChange={(e) => updateManualFix(rowNumber, { state: e.target.value })}
                        >
                          <option value="">Select state</option>
                          {STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="mb-1 text-gray-700">Manual district</p>
                        <select
                          className="border rounded px-2 py-1 w-full"
                          value={fix.district}
                          onChange={(e) => updateManualFix(rowNumber, { district: e.target.value })}
                          disabled={!fixState}
                        >
                          <option value="">{fixState ? "Select district" : "Select state first"}</option>
                          {fixDistrictOptions.map((districtOption) => (
                            <option key={districtOption} value={districtOption}>
                              {districtOption}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}

                  {row.duplicateInDb ? <p className="text-red-700">Duplicate in DB</p> : null}
                  {row.duplicateInFile ? <p className="text-red-700">Duplicate in file</p> : null}
                  {row.errors.length ? <p className="text-red-700">{row.errors.join(", ")}</p> : null}
                </div>
              );
            })}
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
        <p className="text-sm text-gray-600 mb-3">
          Manual entry uses the same fields as CSV: type, name, state, and district.
        </p>
        <form onSubmit={requestAccount} className="space-y-3 max-w-xl">
          <div>
            <label htmlFor="req-type" className="block text-sm font-medium mb-1">
              Type
            </label>
            <select
              id="req-type"
              className="border rounded px-3 py-2 w-full text-sm"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as "SCHOOL" | "PARTNER")}
              required
            >
              <option value="SCHOOL">School</option>
              <option value="PARTNER">Partner</option>
            </select>
          </div>
          <div>
            <label htmlFor="req-name" className="block text-sm font-medium mb-1">
              {nameLabel}
            </label>
            <input
              id="req-name"
              className="border rounded px-3 py-2 w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="req-state" className="block text-sm font-medium mb-1">
              State
            </label>
            <select
              id="req-state"
              className="border rounded px-3 py-2 w-full text-sm"
              value={requestState}
              onChange={(e) => {
                setRequestState(e.target.value);
                setDistrict("");
              }}
              required
            >
              <option value="">Select state</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="req-district" className="block text-sm font-medium mb-1">
              District
            </label>
            <select
              id="req-district"
              className="border rounded px-3 py-2 w-full text-sm"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              disabled={!selectedState}
              required
            >
              <option value="">{selectedState ? "Select district" : "Select state first"}</option>
              {districtOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!formValid}
            className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Request Account
          </button>
        </form>
        {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
      </section>

      {isAdmin ? (
        <section className="border rounded-lg p-4">
          <h2 className="font-medium mb-3">Pending Accounts (Admin)</h2>
          {pending.length === 0 ? (
            <p>No pending accounts.</p>
          ) : (
            <div className="overflow-x-auto border rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-2 font-medium">Name</th>
                    <th className="p-2 font-medium">Type</th>
                    <th className="p-2 font-medium">District</th>
                    <th className="p-2 font-medium">State</th>
                    <th className="p-2 font-medium">Requested By</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium w-[1%] whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((account) => (
                    <tr key={account.id} className="border-b last:border-0">
                      <td className="p-2 align-middle">{account.name}</td>
                      <td className="p-2 align-middle">{formatAccountType(account.type)}</td>
                      <td className="p-2 align-middle text-gray-700">{account.district ?? "—"}</td>
                      <td className="p-2 align-middle text-gray-700">{account.state ?? "—"}</td>
                      <td className="p-2 align-middle text-gray-700">
                        {account.requestedBy?.name ?? "Unknown"}
                      </td>
                      <td className="p-2 align-middle">{formatAccountStatus(account)}</td>
                      <td className="p-2 align-middle">
                        <div className="flex gap-2 justify-end">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="border rounded-lg p-4">
          <h2 className="font-medium mb-3">Needs Assignment</h2>
          {needsAssignment.length === 0 ? (
            <p className="text-sm text-gray-600">No approved unassigned accounts.</p>
          ) : (
            <div className="space-y-2">
              {needsAssignment.map((account) => (
                <div key={account.id} className="border rounded p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-gray-600">
                      {account.district ?? "—"}, {account.state ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={assignUserByAccount[account.id] ?? ""}
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
                      className="rounded border px-3 py-1 text-sm"
                      type="button"
                      onClick={() => assign(account.id)}
                    >
                      Assign
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!isAdmin ? (
        <section className="border rounded-lg p-4 space-y-4">
          <h2 className="font-medium">My Accounts</h2>

          <div>
            <h3 className="text-sm font-medium mb-2">Pending</h3>
            {myPendingAccounts.length === 0 ? (
              <p className="text-sm text-gray-600">No pending accounts.</p>
            ) : (
              <div className="border rounded divide-y">
                {myPendingAccounts.map((account) => (
                  <div key={account.id} className="p-2 text-sm flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{account.name}</p>
                    <div className="text-xs text-gray-600 flex items-center gap-3">
                      <span>{formatAccountStatus(account)}</span>
                      <span>Owner: {account.assignedTo?.name || "Unassigned"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Approved (Not Assigned)</h3>
            {myApprovedAccounts.length === 0 ? (
              <p className="text-sm text-gray-600">No approved unassigned accounts.</p>
            ) : (
              <div className="border rounded divide-y">
                {myApprovedAccounts.map((account) => (
                  <div key={account.id} className="p-2 text-sm flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{account.name}</p>
                    <div className="text-xs text-gray-600 flex items-center gap-3">
                      <span>{formatAccountStatus(account)}</span>
                      <span>Owner: {account.assignedTo?.name || "Unassigned"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Assigned</h3>
            {myAssignedAccounts.length === 0 ? (
              <p className="text-sm text-gray-600">No assigned accounts.</p>
            ) : (
              <div className="border rounded divide-y">
                {myAssignedAccounts.map((account) => (
                  <div key={account.id} className="p-2 text-sm flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{account.name}</p>
                    <div className="text-xs text-gray-600 flex items-center gap-3">
                      <span>{formatAccountStatus(account)}</span>
                      <span>Owner: {account.assignedTo?.name || "Unassigned"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">All Accounts (Search)</h2>
        <div className="space-y-3">
          <input
            className="border rounded px-3 py-2 w-full max-w-xl"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by account name..."
          />
          {!searchEnabled ? (
            <p className="text-sm text-gray-600">Type to search accounts.</p>
          ) : searchResults.length === 0 ? (
            <p className="text-sm text-gray-600">No results found.</p>
          ) : (
            <div className="border rounded divide-y">
              {searchResults.map((account) => (
                <div key={account.id} className="p-2 text-sm flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{account.name}</p>
                  <div className="text-xs text-gray-600 flex items-center gap-3">
                    <span>{formatAccountStatus(account)}</span>
                    <span>Owner: {account.assignedTo?.name || "Unassigned"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
