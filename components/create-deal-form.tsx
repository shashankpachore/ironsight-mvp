"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { PRODUCT_OPTIONS } from "@/lib/products";
import { useTestSession } from "./test-session-bar";

type SearchAccount = {
  id: string;
  name: string;
};

export function CreateDealForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { header } = useTestSession();
  const headerRef = useRef(header);

  const [form, setForm] = useState({ name: PRODUCT_OPTIONS[0], accountId: "", value: "" });
  const [accountQuery, setAccountQuery] = useState("");
  const [accountResults, setAccountResults] = useState<SearchAccount[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [accountSearchCompleted, setAccountSearchCompleted] = useState(false);
  const [error, setError] = useState("");

  const accountPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!accountPickerRef.current?.contains(e.target as Node)) {
        setAccountDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    headerRef.current = header;
  }, [header]);

  useEffect(() => {
    const trimmed = accountQuery.trim();
    if (trimmed.length < 2) {
      queueMicrotask(() => {
        setAccountResults([]);
        setAccountLoading(false);
        setAccountDropdownOpen(false);
        setAccountSearchCompleted(false);
      });
      return;
    }

    queueMicrotask(() => {
      setAccountDropdownOpen(true);
    });
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAccountLoading(true);
      setAccountSearchCompleted(false);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "20" });
        const res = await fetch(`/api/accounts/search?${params.toString()}`, {
          headers: headerRef.current,
          signal: controller.signal,
        });
        const data = (await res.json()) as { accounts?: SearchAccount[] };
        if (cancelled) return;
        if (!res.ok) {
          setAccountResults([]);
          return;
        }
        setAccountResults(Array.isArray(data.accounts) ? data.accounts : []);
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).name === "AbortError") return;
        setAccountResults([]);
      } finally {
        if (!cancelled) {
          setAccountLoading(false);
          setAccountSearchCompleted(true);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      setAccountLoading(false);
    };
  }, [accountQuery]);

  async function createDeal(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.accountId) {
      setError("Select an approved account");
      return;
    }

    const res = await fetch("/api/deals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headerRef.current,
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
    setAccountQuery("");
    setAccountResults([]);
    setAccountDropdownOpen(false);
    setAccountSearchCompleted(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["deals"] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline"] }),
    ]);
    router.refresh();
  }

  return (
    <>
      <form onSubmit={createDeal} className="grid gap-3 md:grid-cols-4">
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
        <div ref={accountPickerRef} className="relative">
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            placeholder="Search account (min 2 characters)"
            value={accountQuery}
            onChange={(e) => {
              setAccountQuery(e.target.value);
              setForm((s) => ({ ...s, accountId: "" }));
            }}
            onFocus={() => {
              if (accountQuery.trim().length >= 2) setAccountDropdownOpen(true);
            }}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={accountDropdownOpen}
          />
          {accountDropdownOpen ? (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border bg-white shadow">
              {accountLoading ? (
                <div className="px-3 py-2 text-sm text-gray-600">Loading…</div>
              ) : accountSearchCompleted && accountResults.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-600">No results</div>
              ) : (
                accountResults.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => {
                      setForm((s) => ({ ...s, accountId: account.id }));
                      setAccountQuery(account.name);
                      setAccountDropdownOpen(false);
                      setAccountLoading(false);
                    }}
                  >
                    {account.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
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
