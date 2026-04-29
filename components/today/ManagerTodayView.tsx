"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useManagerTodayFull } from "@/hooks/useManagerTodayFull";
import { formatInr } from "@/lib/currency";

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
  expiredDealsSummary: {
    totalExpiredDeals: number;
    totalExpiredValue: number;
    byRep: Array<{
      ownerId: string;
      ownerName: string;
      expiredDeals: number;
      expiredValue: number;
    }>;
  };
  expiringSoonDealsSummary: {
    totalExpiringSoon: number;
    totalValue: number;
    byRep: Array<{
      ownerId: string;
      ownerName: string;
      count: number;
      value: number;
    }>;
  };
};

type ManagerFullPayload = {
  today: MyDealsPayload;
  insights: InsightsPayload;
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

function expiredBadgeColor(expiredDeals: number): "RED" | "YELLOW" | "GREEN" {
  if (expiredDeals > 10) return "RED";
  if (expiredDeals >= 5) return "YELLOW";
  return "GREEN";
}

function expiringSoonBadgeColor(count: number): "YELLOW" | "GREEN" {
  return count > 5 ? "YELLOW" : "GREEN";
}

export function ManagerTodayView({
  currentUser,
}: {
  header: HeaderLike;
  currentUser: { id: string; role: string } | null | undefined;
}) {
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const managerFullQuery = useManagerTodayFull<ManagerFullPayload>(Boolean(currentUser?.id));
  const myDeals = managerFullQuery.data?.today ?? null;
  const insights = managerFullQuery.data?.insights ?? null;
  const loading = managerFullQuery.isLoading;
  const error = managerFullQuery.error;

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
      {error ? <p className="text-sm text-red-600">Failed to load manager view.</p> : null}

      {!loading && !error && myDeals ? (
        <>
          {/* SECTION 1: Priority Actions */}
          <section className="border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">Priority Actions</h2>
            {priorityActions.my.length === 0 && (priorityActions.team?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">No priority actions right now.</p>
            ) : (
              <div className="space-y-2">
                {[...priorityActions.my]
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

          {/* SECTION 3: Expiring Soon Deals */}
          <section className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Expiring Soon (Next 15 Days)</h2>
              <p className="text-sm font-medium">
                Total Value: {formatInr(insights?.expiringSoonDealsSummary?.totalValue ?? 0)}
              </p>
            </div>
            {(insights?.expiringSoonDealsSummary?.byRep?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">No deals are nearing expiry right now.</p>
            ) : (
              <div className="space-y-2">
                {(insights?.expiringSoonDealsSummary?.byRep ?? []).map((rep) => {
                  const color = expiringSoonBadgeColor(rep.count);
                  return (
                    <div
                      key={rep.ownerId}
                      className="flex flex-wrap items-center justify-between gap-3 border rounded-lg p-3"
                    >
                      <p className="font-medium">
                        {rep.ownerName} — {rep.count} deal
                        {rep.count === 1 ? "" : "s"} — {formatInr(rep.value)}
                      </p>
                      <span className={`text-xs rounded border px-2 py-0.5 ${badgeClass(color)}`}>
                        {color}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 4: Expired Deals */}
          <section className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Expired Deals (Pipeline Leakage)</h2>
              <p className="text-sm font-medium">
                Total Expired Value: {formatInr(insights?.expiredDealsSummary?.totalExpiredValue ?? 0)}
              </p>
            </div>
            <p className="text-sm text-gray-700">
              Expired deals indicate missed follow-ups. High numbers suggest poor pipeline discipline.
            </p>
            {(insights?.expiredDealsSummary?.byRep?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">No expired deals right now.</p>
            ) : (
              <div className="space-y-2">
                {(insights?.expiredDealsSummary?.byRep ?? []).map((rep) => {
                  const color = expiredBadgeColor(rep.expiredDeals);
                  return (
                    <div
                      key={rep.ownerId}
                      className="flex flex-wrap items-center justify-between gap-3 border rounded-lg p-3"
                    >
                      <p className="font-medium">
                        {rep.ownerName} — {rep.expiredDeals} deal
                        {rep.expiredDeals === 1 ? "" : "s"} — {formatInr(rep.expiredValue)}
                      </p>
                      <span className={`text-xs rounded border px-2 py-0.5 ${badgeClass(color)}`}>
                        {color}
                      </span>
                    </div>
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

