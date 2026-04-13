"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";

type TodayItem = {
  dealId: string;
  accountName: string;
  nextStepType: string | null;
  nextStepDate: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  daysOverdue: number;
};

type TodayPayload = {
  mode: "REP";
  critical: TodayItem[];
  attention: TodayItem[];
  upcoming: TodayItem[];
};

type ManagerRepSummary = {
  repId: string;
  repName: string;
  repEmail: string;
  color: "RED" | "YELLOW" | "GREEN";
  stale: boolean;
  hasCritical: boolean;
  criticalCount: number;
  attentionCount: number;
};

type ManagerPayload = {
  mode: "MANAGER";
  reps: ManagerRepSummary[];
  selectedRepId: string | null;
  drilldown: {
    critical: TodayItem[];
    attention: TodayItem[];
  };
};

type ApiPayload = TodayPayload | ManagerPayload;

function formatDateLabel(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function Bucket({
  title,
  items,
}: {
  title: string;
  items: TodayItem[];
}) {
  return (
    <section className="border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-600">No deals in this bucket.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.dealId} className="border rounded p-3 space-y-1">
              <p className="font-medium">{item.accountName}</p>
              <p className="text-sm">Next Step: {item.nextStepType ?? "Unknown"}</p>
              <p className="text-sm">Next Step Date: {formatDateLabel(item.nextStepDate)}</p>
              <p className="text-sm text-gray-700">
                Last activity: {item.daysSinceLastActivity} day{item.daysSinceLastActivity === 1 ? "" : "s"} ago
              </p>
              <Link href={`/deals/${item.dealId}/log`} className="inline-block underline text-sm">
                Log Activity
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function TodayPage() {
  const { header, currentUser } = useTestSession();
  const isManager = currentUser?.role === "MANAGER";
  const [data, setData] = useState<ApiPayload>({
    mode: "REP",
    critical: [],
    attention: [],
    upcoming: [],
  } as TodayPayload);
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function loadToday() {
      setLoading(true);
      setError("");
      const url =
        isManager && selectedRepId
          ? `/api/today?repId=${encodeURIComponent(selectedRepId)}`
          : "/api/today";
      const res = await fetch(url, { headers: header });
      if (!mounted) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Failed to load today's actions.");
        setLoading(false);
        return;
      }
      const payload = (await res.json()) as ApiPayload;
      setData(payload);
      if (payload.mode === "MANAGER" && payload.selectedRepId !== selectedRepId) {
        setSelectedRepId(payload.selectedRepId);
      }
      setLoading(false);
    }
    void loadToday();
    return () => {
      mounted = false;
    };
  }, [header, isManager, selectedRepId]);

  function managerRowClass(rep: ManagerRepSummary): string {
    if (rep.hasCritical) return "bg-red-50 border-red-300";
    if (rep.color === "YELLOW") return "bg-yellow-50 border-yellow-300";
    return "";
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Today</h1>
      <p className="text-sm text-gray-700">
        Actionable follow-ups based on next steps and weekly cadence.
      </p>

      {loading ? <p>Loading today&apos;s actions...</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!loading && !error && data.mode === "REP" ? (
        <>
          <Bucket title="🔴 Critical" items={data.critical} />
          <Bucket title="🟠 Needs Attention" items={data.attention} />
          <Bucket title="🟡 Upcoming" items={data.upcoming} />
        </>
      ) : null}

      {!loading && !error && data.mode === "MANAGER" ? (
        <>
          <section className="border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">Team Priority (Daily)</h2>
            {data.reps.length === 0 ? (
              <p className="text-sm text-gray-600">No direct-report reps found.</p>
            ) : (
              <div className="space-y-2">
                {data.reps.map((rep) => (
                  <button
                    key={rep.repId}
                    type="button"
                    className={`w-full border rounded p-3 text-left ${managerRowClass(rep)} ${
                      rep.repId === data.selectedRepId ? "ring-2 ring-black" : ""
                    }`}
                    onClick={() => setSelectedRepId(rep.repId)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {rep.repName} {rep.repEmail ? `(${rep.repEmail})` : ""}
                      </p>
                      <p className="text-sm">
                        Priority: <span className="font-semibold">{rep.color}</span>
                      </p>
                    </div>
                    <p className="text-sm mt-1">
                      Critical: {rep.criticalCount} | Needs Attention: {rep.attentionCount}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      {rep.stale ? (
                        <span className="rounded border border-yellow-500 px-2 py-0.5">
                          Stale
                        </span>
                      ) : null}
                      {rep.hasCritical ? (
                        <span className="rounded border border-red-500 px-2 py-0.5">
                          Critical
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <Bucket title="🔴 Critical" items={data.drilldown.critical} />
          <Bucket title="🟠 Needs Attention" items={data.drilldown.attention} />
        </>
      ) : null}
    </main>
  );
}
