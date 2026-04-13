"use client";

import Link from "next/link";
import { useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import { formatInr } from "@/lib/currency";

type StageSummary = { count: number; value: number };
type PipelineTotals = {
  ACCESS: StageSummary;
  QUALIFIED: StageSummary;
  EVALUATION: StageSummary;
  COMMITTED: StageSummary;
  CLOSED: StageSummary;
};

type ManagerRepPipeline = {
  repId: string;
  repName: string;
  repEmail: string;
  pipeline: PipelineTotals;
};

type ManagerBreakdownRow = {
  managerId: string;
  managerName: string;
  stages: {
    ACCESS: number;
    QUALIFIED: number;
    EVALUATION: number;
    COMMITTED: number;
    CLOSED: number;
  };
  totalValue: number;
};

type PipelineResponse = PipelineTotals | {
  totals: PipelineTotals;
  repPipelines: ManagerRepPipeline[];
};

export default function PipelinePage() {
  const { header, currentUser } = useTestSession();
  const [data, setData] = useState<PipelineTotals | null>(null);
  const [repPipelines, setRepPipelines] = useState<ManagerRepPipeline[]>([]);
  const [managerBreakdown, setManagerBreakdown] = useState<ManagerBreakdownRow[]>([]);
  const [error, setError] = useState("");

  async function loadPipeline() {
    setError("");
    const res = await fetch("/api/pipeline?includeRepBreakdown=1", { headers: header });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to load pipeline");
      return;
    }
    if ("totals" in (body as PipelineResponse)) {
      const typed = body as { totals: PipelineTotals; repPipelines: ManagerRepPipeline[] };
      setData(typed.totals);
      setRepPipelines(typed.repPipelines ?? []);
      setManagerBreakdown([]);
      return;
    }
    setData(body as PipelineTotals);
    setRepPipelines([]);

    if (currentUser?.role === "ADMIN") {
      const managerRes = await fetch("/api/pipeline/manager-breakdown", { headers: header });
      const managerBody = await managerRes.json();
      if (!managerRes.ok) {
        setError(managerBody.error || "Failed to load manager breakdown");
        return;
      }
      setManagerBreakdown(managerBody as ManagerBreakdownRow[]);
      return;
    }
    setManagerBreakdown([]);
  }

  function renderSection(title: string, stages: Array<keyof PipelineTotals>, source: PipelineTotals) {
    return (
      <section className="border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">{title}</h2>
        <table className="w-full border-collapse border text-sm">
          <thead>
            <tr>
              <th className="border p-2 text-left">Stage</th>
              <th className="border p-2 text-left">Count</th>
              <th className="border p-2 text-left">Deal Value</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage}>
                <td className="border p-2">{stage}</td>
                <td className="border p-2">{source[stage].count}</td>
                <td className="border p-2">{formatInr(source[stage].value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/" className="underline">
          Back to deals
        </Link>
        <button type="button" onClick={() => void loadPipeline()} className="underline">
          Refresh pipeline
        </button>
      </div>

      <h1 className="text-2xl font-semibold">Pipeline</h1>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!data ? <p>Click &quot;Refresh pipeline&quot; to load data.</p> : (
        <div className="space-y-4">
          {renderSection("Early Funnel", ["ACCESS", "QUALIFIED"], data)}
          {renderSection("Mid", ["EVALUATION", "COMMITTED"], data)}
          {renderSection("Closed", ["CLOSED"], data)}

          {currentUser?.role === "ADMIN" ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Pipeline by Manager</h2>
              <table className="w-full border-collapse border text-sm">
                <thead>
                  <tr>
                    <th className="border p-2 text-left">Manager Name</th>
                    <th className="border p-2 text-left">ACCESS</th>
                    <th className="border p-2 text-left">QUALIFIED</th>
                    <th className="border p-2 text-left">EVALUATION</th>
                    <th className="border p-2 text-left">COMMITTED</th>
                    <th className="border p-2 text-left">CLOSED</th>
                    <th className="border p-2 text-left">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {managerBreakdown.map((row) => (
                    <tr key={row.managerId}>
                      <td className="border p-2">{row.managerName}</td>
                      <td className="border p-2">{row.stages.ACCESS}</td>
                      <td className="border p-2">{row.stages.QUALIFIED}</td>
                      <td className="border p-2">{row.stages.EVALUATION}</td>
                      <td className="border p-2">{row.stages.COMMITTED}</td>
                      <td className="border p-2">{row.stages.CLOSED}</td>
                      <td className="border p-2">{formatInr(row.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {managerBreakdown.length === 0 ? (
                <p className="text-sm text-gray-600">No manager-owned rep pipeline found.</p>
              ) : null}
            </section>
          ) : null}

          {currentUser?.role === "MANAGER" ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Rep-wise Pipeline</h2>
              {repPipelines.map((rep) => (
                <div key={rep.repId} className="border rounded-lg p-4 space-y-2">
                  <h3 className="font-medium">
                    {rep.repName} ({rep.repEmail})
                  </h3>
                  <table className="w-full border-collapse border text-sm">
                    <thead>
                      <tr>
                        <th className="border p-2 text-left">Stage</th>
                        <th className="border p-2 text-left">Count</th>
                        <th className="border p-2 text-left">Deal Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED", "CLOSED"] as const).map((stage) => (
                        <tr key={stage}>
                          <td className="border p-2">{stage}</td>
                          <td className="border p-2">{rep.pipeline[stage].count}</td>
                          <td className="border p-2">{formatInr(rep.pipeline[stage].value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {repPipelines.length === 0 ? (
                <p className="text-sm text-gray-600">No direct reports found.</p>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
