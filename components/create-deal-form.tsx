"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { PRODUCT_OPTIONS } from "@/lib/products";
import { useTestSession } from "./test-session-bar";

type Account = {
  id: string;
  name: string;
};

export function CreateDealForm() {
  const router = useRouter();
  const { header } = useTestSession();
  const [form, setForm] = useState({ name: PRODUCT_OPTIONS[0], accountId: "", value: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");

  async function loadAccounts() {
    const res = await fetch("/api/accounts", {
      headers: header,
    });
    const data = await res.json();
    if (res.ok) setAccounts(data);
  }

  async function createDeal(e: FormEvent) {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/deals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({
        name: form.name,
        accountId: form.accountId,
        value: Number(form.value),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create deal");
      return;
    }

    setForm({ name: PRODUCT_OPTIONS[0], accountId: "", value: "" });
    router.refresh();
  }

  return (
    <>
      <form onSubmit={createDeal} className="grid gap-3 md:grid-cols-4">
        <button
          type="button"
          className="rounded border px-4 py-2 text-sm md:col-span-4"
          onClick={() => void loadAccounts()}
        >
          Load Approved Accounts
        </button>
        <select
          className="border rounded px-3 py-2"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          required
        >
          <option value="" disabled>
            Select product
          </option>
          {PRODUCT_OPTIONS.map((product) => (
            <option key={product} value={product}>
              {product}
            </option>
          ))}
        </select>
        <select
          className="border rounded px-3 py-2"
          value={form.accountId}
          onChange={(e) => setForm((s) => ({ ...s, accountId: e.target.value }))}
          required
        >
          <option value="">Select approved account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-600 md:col-span-4">
            No assigned approved accounts available
          </p>
        ) : null}
        <input
          className="border rounded px-3 py-2"
          placeholder="Deal Value in ₹"
          type="number"
          min={1}
          value={form.value}
          onChange={(e) => setForm((s) => ({ ...s, value: e.target.value }))}
          required
        />
        <button className="bg-black text-white rounded px-4 py-2">Create</button>
      </form>
      {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
    </>
  );
}
