"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import { OUTCOME_LABELS, type OutcomeValue } from "@/lib/domain";
import { currentIsoWeek, getRecentWeekOptions } from "@/lib/reports/week";

type WeeklyReportRow = {
  userId: string;
  userName: string;
  totalInteractions: number;
  totalDelta: number | null;
  breakdown: Record<OutcomeValue, { value: number; delta: number | null }>;
};

type WeeklyReportResponse = {
  week: string;
  startOfWeek: string;
  endOfWeek: string;
  rows: WeeklyReportRow[];
};

const TABLE_OUTCOMES: OutcomeValue[] = [
  "DEMO_DONE",
  "NEGOTIATION_STARTED",
  "PROPOSAL_SHARED",
  "DEAL_CONFIRMED",
  "PO_RECEIVED",
  "NO_RESPONSE",
  "FOLLOW_UP_DONE",
];

function formatDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="ml-1 text-xs text-gray-400">-</span>;
  if (value > 0) return <span className="ml-1 text-xs text-green-700">+{value}</span>;
  if (value < 0) return <span className="ml-1 text-xs text-red-700">{value}</span>;
  return <span className="ml-1 text-xs text-gray-400">0</span>;
}

function MetricCell({ value, delta }: { value: number; delta: number | null }) {
  return (
    <span className="inline-flex items-baseline justify-end">
      <span>{value}</span>
      <Delta value={delta} />
    </span>
  );
}

export default function WeeklyReportPage() {
  const { header, currentUser } = useTestSession();
  const [selectedWeek, setSelectedWeek] = useState(() => currentIsoWeek());
  const weekOptions = useMemo(() => getRecentWeekOptions(12), []);
  const reportQuery = useQuery({
    queryKey: ["weekly-report", selectedWeek],
    queryFn: async () => {
      const res = await fetch(`/api/reports/weekly?week=${encodeURIComponent(selectedWeek)}`, { headers: header });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load weekly report");
      return body as WeeklyReportResponse;
    },
  });
  const report = reportQuery.data ?? null;

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="underline text-sm">
            Back to deals
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Weekly Execution Report</h1>
          <p className="text-sm text-gray-600">
            Activity volume and outcome breakdown by deal owner.
          </p>
        </div>
        <div className="text-sm text-gray-600">
          Current user: {currentUser ? `${currentUser.email} (${currentUser.role})` : "Unknown"}
        </div>
      </div>

      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Week</h2>
            {report ? (
              <p className="text-sm text-gray-600">
                {formatDate(report.startOfWeek)} to {formatDate(report.endOfWeek)}
              </p>
            ) : null}
          </div>
          <select
            className="rounded border px-3 py-2 text-sm"
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
          >
            {weekOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {reportQuery.error ? <p className="text-sm text-red-600">{reportQuery.error.message}</p> : null}
        {reportQuery.isLoading ? <p className="text-sm text-gray-600">Loading weekly report...</p> : null}

        {!reportQuery.isLoading && report?.rows.length === 0 ? (
          <p className="rounded border bg-gray-50 p-4 text-sm text-gray-600">
            No interactions logged for this week.
          </p>
        ) : null}

        {report && report.rows.length > 0 ? (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-2 font-medium">Rep</th>
                  <th className="p-2 text-right font-medium">Total</th>
                  {TABLE_OUTCOMES.map((outcome) => (
                    <th key={outcome} className="p-2 text-right font-medium">
                      {OUTCOME_LABELS[outcome]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.userId} className="border-b last:border-0">
                    <td className="p-2 font-medium">{row.userName}</td>
                    <td className="p-2 text-right">
                      <MetricCell value={row.totalInteractions} delta={row.totalDelta} />
                    </td>
                    {TABLE_OUTCOMES.map((outcome) => (
                      <td key={outcome} className="p-2 text-right">
                        <MetricCell
                          value={row.breakdown[outcome]?.value ?? 0}
                          delta={row.breakdown[outcome]?.delta ?? null}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
