"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setErrorDetail("");
    setErrorCode("");
    setLoading(true);

    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch (fetchErr) {
      setLoading(false);
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      setError("Network error: could not reach the server.");
      setErrorDetail(msg);
      setErrorCode("NETWORK");
      return;
    }

    setLoading(false);

    let payload: { ok?: boolean; error?: string; code?: string; detail?: string };
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      setError(`Login failed (HTTP ${res.status}). Response was not JSON.`);
      setErrorCode("BAD_RESPONSE");
      return;
    }

    if (!res.ok) {
      setError(payload.error || "Login failed");
      setErrorDetail(payload.detail || "");
      setErrorCode(payload.code || "");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Login</h1>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button
          type="submit"
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-1">
          <p className="font-medium">{error}</p>
          {errorDetail ? <p className="text-red-800 whitespace-pre-wrap break-words">{errorDetail}</p> : null}
          {errorCode ? <p className="text-xs text-red-700 font-mono">Code: {errorCode}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
