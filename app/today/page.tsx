"use client";

import Link from "next/link";
import { ManagerTodayView } from "@/components/today/ManagerTodayView";
import { useTestSession } from "@/components/test-session-bar";
import { useTodayRep } from "@/hooks/useTodayRep";

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

type TodayPayload = { mode: "REP"; critical: TodayItem[]; attention: TodayItem[]; upcoming: TodayItem[] };

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
    upcoming: TodayItem[];
  };
};

type ApiPayload = TodayPayload | ManagerPayload;

function RepTodayPage() {
  const todayQuery = useTodayRep<ApiPayload>();
  const data = todayQuery.data ?? ({
    mode: "REP",
    critical: [],
    attention: [],
    upcoming: [],
  } as TodayPayload);
  const loading = todayQuery.isLoading;
  const error = todayQuery.error;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Today</h1>
      <p className="text-sm text-gray-700">
        Actionable follow-ups based on next steps and weekly cadence.
      </p>

      {loading ? <p>Loading today&apos;s actions...</p> : null}
      {error ? <p className="text-sm text-red-600">Failed to load today&apos;s actions.</p> : null}

      {!loading && !error && data.mode === "REP" ? (
        <section className="border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">Today&apos;s Actions</h2>
          {(() => {
            const merged = [...data.critical, ...data.attention, ...data.upcoming].sort(
              (a, b) => b.score - a.score,
            );
            if (merged.length === 0) {
              return <p className="text-sm text-gray-600">No actions for today.</p>;
            }
            return (
              <div className="space-y-2">
                {merged.map((item) => (
                  <Link
                    key={item.dealId}
                    href={`/deals/${item.dealId}/log`}
                    className="block border rounded p-3 space-y-1"
                  >
                    <p className="font-medium">{item.accountName}</p>
                    <p className="text-sm">⚠ {item.reason}</p>
                    <p className="text-sm">👉 {item.actionMessage}</p>
                  </Link>
                ))}
              </div>
            );
          })()}
        </section>
      ) : null}
    </main>
  );
}

function ManagerTodayPage({
  header,
  currentUser,
}: {
  header: HeadersInit | undefined;
  currentUser: { id: string; role: string } | null | undefined;
}) {
  return <ManagerTodayView header={header} currentUser={currentUser} />;
}

export default function TodayPage() {
  const { header, currentUser } = useTestSession();

  if (currentUser?.role === "MANAGER") {
    return <ManagerTodayPage header={header} currentUser={currentUser} />;
  }

  return <RepTodayPage />;
}
