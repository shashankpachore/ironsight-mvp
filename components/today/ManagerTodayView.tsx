"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type HeaderLike = HeadersInit | undefined;

type TodayItem = {
  dealId: string;
  accountName: string;
  nextStepType: string | null;
  nextStepDate: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  daysOverdue: number;
  score: number;
  actionMessage: string;
  reason: string;
};

type MyDealsPayload = {
  mode: "MANAGER";
  drilldown: {
    critical: TodayItem[];
    attention: TodayItem[];
    upcoming: TodayItem[];
  };
};

type InsightsPayload = {
  atRiskDeals: Array<{
    dealId: string;
    accountName: string;
    ownerId: string;
    ownerName: string;
    stage: string;
    value: number;
    daysSinceLastActivity: number;
    reason: string;
  }>;
  repHealth: Array<{
    repId: string;
    repName: string;
    criticalDeals: number;
    staleDeals: number;
    lastActivityAt: string | null;
    activityScore: number;
    color: "RED" | "YELLOW" | "GREEN";
  }>;
  interventions: Array<{
    dealId: string;
    suggestedAction: string;
  }>;
};

function badgeClass(color: "RED" | "YELLOW" | "GREEN"): string {
  if (color === "RED") return "border-red-500 text-red-700 bg-red-50";
  if (color === "YELLOW") return "border-yellow-500 text-yellow-800 bg-yellow-50";
  return "border-green-600 text-green-800 bg-green-50";
}

function repHint(color: "RED" | "YELLOW" | "GREEN"): string | null {
  if (color === "RED") return "Immediate intervention needed";
  return null;
}

export function ManagerTodayView({
  header,
  currentUser,
}: {
  header: HeaderLike;
  currentUser: { id: string; role: string } | null | undefined;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [myDeals, setMyDeals] = useState<MyDealsPayload | null>(null);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError("");

      try {
        const managerId = currentUser?.id;
        if (!managerId) {
          throw new Error("missing manager id");
        }

        const [todayRes, insightsRes] = await Promise.all([
          fetch(`/api/today?repId=${encodeURIComponent(managerId)}`, { headers: header }),
          fetch("/api/manager/insights", { headers: header }),
        ]);

        if (!todayRes.ok) {
          const body = (await todayRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to load your deals.");
        }
        if (!insightsRes.ok) {
          const body = (await insightsRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to load team insights.");
        }

        const todayPayload = (await todayRes.json()) as MyDealsPayload;
        const insightsPayload = (await insightsRes.json()) as InsightsPayload;

        if (!mounted) return;
        setMyDeals(todayPayload);
        setInsights(insightsPayload);
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load manager view.");
        setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [header, currentUser?.id]);

  const interventionByDealId = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of insights?.interventions ?? []) {
      m.set(i.dealId, i.suggestedAction);
    }
    return m;
  }, [insights]);

  const priorityActions = useMemo(() => {
    const my = myDeals
      ? [...myDeals.drilldown.critical, ...myDeals.drilldown.attention, ...myDeals.drilldown.upcoming]
      : [];
    const team = insights?.atRiskDeals ?? [];
    return { my, team };
  }, [myDeals, insights]);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Today</h1>
      <p className="text-sm text-gray-700">Actionable follow-ups based on next steps and weekly cadence.</p>

      {loading ? <p>Loading manager view...</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!loading && !error && myDeals ? (
        <>
          {/* SECTION 1: Priority Actions */}
          <section className="border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">Priority Actions</h2>
            {priorityActions.my.length === 0 && (priorityActions.team?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">No priority actions right now.</p>
            ) : (
              <div className="space-y-2">
                {priorityActions.my
                  .sort((a, b) => b.score - a.score)
                  .map((item) => (
                    <Link
                      key={`my-${item.dealId}`}
                      href={`/deals/${item.dealId}/log`}
                      className="block border rounded p-3 space-y-1"
                    >
                      <p className="font-medium">{item.accountName}</p>
                      <p className="text-sm">⚠ {item.reason}</p>
                      <p className="text-sm">👉 {item.actionMessage}</p>
                    </Link>
                  ))}
                {(priorityActions.team ?? []).map((d) => (
                  <Link
                    key={`team-${d.dealId}`}
                    href={`/deals/${d.dealId}`}
                    className="block border rounded p-3 space-y-1"
                  >
                    <p className="font-medium">{d.accountName}</p>
                    <p className="text-sm text-gray-700">Rep: {d.ownerName}</p>
                    <p className="text-sm">⚠ {d.reason}</p>
                    <p className="text-sm">👉 {interventionByDealId.get(d.dealId) ?? "Escalate immediately"}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 2: Reps Needing Attention */}
          <section className="space-y-3">
            <h2 className="font-medium">🚨 Reps Needing Attention</h2>
            {(insights?.repHealth?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">No reps found.</p>
            ) : (
              <div className="space-y-2">
                {(insights?.repHealth ?? []).map((rep) => {
                  const hint = repHint(rep.color);
                  const criticalSchools = (insights?.atRiskDeals ?? []).filter(
                    (deal) => deal.ownerId === rep.repId,
                  );
                  const isExpanded = selectedRepId === rep.repId;
                  return (
                    <button
                      type="button"
                      key={rep.repId}
                      className="w-full text-left border rounded-lg p-4 hover:bg-gray-50"
                      onClick={() =>
                        setSelectedRepId((prev) => (prev === rep.repId ? null : rep.repId))
                      }
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{rep.repName}</p>
                        <span className={`text-xs rounded border px-2 py-0.5 ${badgeClass(rep.color)}`}>
                          {rep.color}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mt-1">Critical: {rep.criticalDeals}</p>
                      {hint ? <p className="text-sm mt-2">{hint}</p> : null}
                      {isExpanded ? (
                        <div className="mt-3 border-t pt-3 space-y-2">
                          {criticalSchools.length === 0 ? (
                            <p className="text-sm text-gray-600">No critical schools for this rep right now.</p>
                          ) : (
                            criticalSchools.map((deal, index) => (
                              <Link
                                key={deal.dealId}
                                href={`/deals/${deal.dealId}`}
                                className="block border rounded p-2 text-sm"
                              >
                                <p className="font-medium">
                                  {index + 1}. {deal.accountName}
                                </p>
                                <p className="text-gray-700">
                                  Stage: {deal.stage} | Value: {deal.value.toLocaleString("en-IN")}
                                </p>
                                <p className="text-gray-700">
                                  Last activity: {deal.daysSinceLastActivity} day
                                  {deal.daysSinceLastActivity === 1 ? "" : "s"} ago
                                </p>
                              </Link>
                            ))
                          )}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

