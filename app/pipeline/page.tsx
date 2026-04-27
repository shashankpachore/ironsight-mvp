"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import { formatInr } from "@/lib/currency";

type StageSummary = { count: number; value: number };
type PipelineTotals = {
  ACCESS: StageSummary;
  QUALIFIED: StageSummary;
  EVALUATION: StageSummary;
  COMMITTED: StageSummary;
};
type OutcomeSummary = {
  CLOSED: StageSummary;
  LOST: StageSummary;
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
    ACCESS: StageSummary;
    QUALIFIED: StageSummary;
    EVALUATION: StageSummary;
    COMMITTED: StageSummary;
  };
  totalValue: number;
  outcomes: OutcomeSummary;
};

type PipelineResponse = PipelineTotals | {
  totals: PipelineTotals;
  outcomes: OutcomeSummary;
  repPipelines: ManagerRepPipeline[];
};
type PipelineStage = keyof PipelineTotals;
type DrilldownStage = PipelineStage | keyof OutcomeSummary;
const PIPELINE_STAGES: PipelineStage[] = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED"];
const ZERO_STAGE_SUMMARY: StageSummary = { count: 0, value: 0 };
type DrilldownDeal = {
  id: string;
  value: number;
  stage: string;
  lastActivityAt: string;
  account: { name: string };
};
type DrilldownState = {
  loading: boolean;
  error: string;
  deals: DrilldownDeal[];
};
type DrilldownFilters = { ownerId?: string; managerId?: string; unassigned?: boolean };

export default function PipelinePage() {
  const { header, currentUser } = useTestSession();
  const [data, setData] = useState<PipelineTotals | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeSummary | null>(null);
  const [repPipelines, setRepPipelines] = useState<ManagerRepPipeline[]>([]);
  const [managerBreakdown, setManagerBreakdown] = useState<ManagerBreakdownRow[]>([]);
  const [error, setError] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [drilldownByKey, setDrilldownByKey] = useState<Record<string, DrilldownState>>({});

  async function loadPipeline() {
    setError("");
    const res = await fetch("/api/pipeline?includeRepBreakdown=1&includeOutcomes=1", { headers: header });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Failed to load pipeline");
      return;
    }
    if ("totals" in (body as PipelineResponse)) {
      const typed = body as { totals: PipelineTotals; outcomes: OutcomeSummary; repPipelines: ManagerRepPipeline[] };
      setData(typed.totals);
      setOutcomes(typed.outcomes ?? null);
      if (currentUser?.role === "MANAGER") {
        setRepPipelines(typed.repPipelines ?? []);
        setManagerBreakdown([]);
        return;
      }
      setRepPipelines([]);
    }
    if (!("totals" in (body as PipelineResponse))) {
      setData(body as PipelineTotals);
      setOutcomes(null);
      setRepPipelines([]);
    }

    if (currentUser?.role === "ADMIN") {
      const managerRes = await fetch("/api/pipeline/manager-breakdown", { headers: header });
      const managerBody = await managerRes.json();
      if (!managerRes.ok) {
        setError(managerBody.error || "Failed to load manager breakdown");
        return;
      }
      const managerData = normalizeManagerData(managerBody);
      setManagerBreakdown(managerData);
      return;
    }
    setManagerBreakdown([]);
  }

  function renderDealDrilldown(key: string, colSpan: number) {
    if (expandedKey !== key) return null;
    const state = drilldownByKey[key];
    return (
      <tr key={key}>
        <td className="border p-2 bg-gray-50" colSpan={colSpan}>
          {!state || state.loading ? (
            <p className="text-sm text-gray-600">Loading deals...</p>
          ) : state.error ? (
            <p className="text-sm text-red-600">{state.error}</p>
          ) : state.deals.length === 0 ? (
            <p className="text-sm text-gray-600">No deals found for this stage.</p>
          ) : (
            <div className="divide-y">
              {state.deals.map((deal, index) => (
                <div key={deal.id} className="text-sm flex flex-wrap gap-4 py-2">
                  <span className="w-8 shrink-0 text-gray-500">{index + 1}.</span>
                  <span className="font-medium">{deal.account.name}</span>
                  <span>{formatInr(deal.value)}</span>
                  <span>{deal.stage}</span>
                  <span className="text-gray-600">
                    Last activity:{" "}
                    {deal.lastActivityAt ? new Date(deal.lastActivityAt).toLocaleString() : "N/A"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </td>
      </tr>
    );
  }

  function renderDrilldownButton(params: {
    keyId: string;
    stage: DrilldownStage;
    filters?: DrilldownFilters;
    label: string;
  }) {
    const isOpen = expandedKey === params.keyId;
    return (
      <button
        type="button"
        aria-label={`${isOpen ? "Hide deals for" : "View deals for"} ${params.label}`}
        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
        onClick={() => void toggleDrilldown(params.keyId, params.stage, params.filters)}
      >
        {isOpen ? "Hide deals" : "View deals"}
      </button>
    );
  }

  async function toggleDrilldown(
    key: string,
    stage: DrilldownStage,
    filters?: DrilldownFilters,
  ) {
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (drilldownByKey[key]) return;
    setDrilldownByKey((prev) => ({
      ...prev,
      [key]: { loading: true, error: "", deals: [] },
    }));
    const params = new URLSearchParams({ stage });
    if (filters?.ownerId) params.set("ownerId", filters.ownerId);
    if (filters?.managerId) params.set("managerId", filters.managerId);
    if (filters?.unassigned) params.set("unassigned", "1");
    const res = await fetch(`/api/deals?${params.toString()}`, { headers: header });
    let body: unknown = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (!res.ok) {
      const err = (body as { error?: string }).error ?? "Failed to load deals";
      setDrilldownByKey((prev) => ({
        ...prev,
        [key]: { loading: false, error: err, deals: [] },
      }));
      return;
    }
    setDrilldownByKey((prev) => ({
      ...prev,
      [key]: {
        loading: false,
        error: "",
        deals: (body as DrilldownDeal[]) ?? [],
      },
    }));
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
              <th className="border p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => {
              const key = `main:${stage}`;
              return (
                <Fragment key={key}>
                  <tr>
                    <td className="border p-2">{stage}</td>
                    <td className="border p-2">{source[stage].count}</td>
                    <td className="border p-2">{formatInr(source[stage].value)}</td>
                    <td className="border p-2">
                      {renderDrilldownButton({
                        keyId: key,
                        stage,
                        label: stage,
                      })}
                    </td>
                  </tr>
                  {renderDealDrilldown(key, 4)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  }

  function safeStageCell(stages: Partial<Record<PipelineStage, StageSummary>> | null | undefined, stage: PipelineStage): StageSummary {
    const cell = stages?.[stage];
    return {
      count: typeof cell?.count === "number" && Number.isFinite(cell.count) ? cell.count : 0,
      value: typeof cell?.value === "number" && Number.isFinite(cell.value) ? cell.value : 0,
    };
  }

  function normalizeManagerData(input: unknown): ManagerBreakdownRow[] {
    if (!Array.isArray(input)) return [];
    return input.map((row) => {
      const typed = (row ?? {}) as Record<string, unknown>;
      const rawStages = (typed.stages ?? {}) as Record<string, unknown>;
      const stages = PIPELINE_STAGES.reduce((acc, stage) => {
        const raw = rawStages[stage];
        if (typeof raw === "number" && Number.isFinite(raw)) {
          acc[stage] = { count: raw, value: 0 };
          return acc;
        }
        if (raw && typeof raw === "object") {
          const count = (raw as { count?: unknown }).count;
          const value = (raw as { value?: unknown }).value;
          acc[stage] = {
            count: typeof count === "number" && Number.isFinite(count) ? count : 0,
            value: typeof value === "number" && Number.isFinite(value) ? value : 0,
          };
          return acc;
        }
        acc[stage] = { count: 0, value: 0 };
        return acc;
      }, {} as Record<PipelineStage, StageSummary>);

      const rawOutcomes = (typed.outcomes ?? {}) as Record<string, unknown>;
      const normalizeOutcome = (key: keyof OutcomeSummary): StageSummary => {
        const raw = rawOutcomes[key];
        if (raw && typeof raw === "object") {
          const count = (raw as { count?: unknown }).count;
          const value = (raw as { value?: unknown }).value;
          return {
            count: typeof count === "number" && Number.isFinite(count) ? count : 0,
            value: typeof value === "number" && Number.isFinite(value) ? value : 0,
          };
        }
        return { count: 0, value: 0 };
      };

      return {
        managerId: typeof typed.managerId === "string" ? typed.managerId : "",
        managerName: typeof typed.managerName === "string" ? typed.managerName : "Unknown",
        stages,
        totalValue:
          typeof typed.totalValue === "number" && Number.isFinite(typed.totalValue)
            ? typed.totalValue
            : 0,
        outcomes: {
          CLOSED: normalizeOutcome("CLOSED"),
          LOST: normalizeOutcome("LOST"),
        },
      };
    });
  }

  function formatStageCell(summary: StageSummary | null | undefined) {
    const safe = {
      count: typeof summary?.count === "number" && Number.isFinite(summary.count) ? summary.count : 0,
      value: typeof summary?.value === "number" && Number.isFinite(summary.value) ? summary.value : 0,
    };
    return `${safe.count} deals / ${formatInr(safe.value)}`;
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
          {outcomes ? (
            <section className="border rounded-lg p-4 space-y-2">
              <h2 className="font-medium">Outcomes</h2>
              <table className="w-full border-collapse border text-sm">
                <thead>
                  <tr>
                    <th className="border p-2 text-left">Stage</th>
                    <th className="border p-2 text-left">Count</th>
                    <th className="border p-2 text-left">Deal Value</th>
                    <th className="border p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(["CLOSED", "LOST"] as const).map((stage) => {
                    const key = `outcome:${stage}`;
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td className="border p-2">{stage}</td>
                          <td className="border p-2">{outcomes[stage].count}</td>
                          <td className="border p-2">{formatInr(outcomes[stage].value)}</td>
                          <td className="border p-2">
                            {renderDrilldownButton({
                              keyId: key,
                              stage,
                              label: stage,
                            })}
                          </td>
                        </tr>
                        {renderDealDrilldown(key, 4)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : null}

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
                    <th className="border p-2 text-left">Total Value</th>
                    <th className="border p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const unassignedRow =
                      managerBreakdown.find((row) => row.managerId === "UNASSIGNED") ?? null;
                    const managerRows = managerBreakdown.filter(
                      (row) => row.managerId !== "UNASSIGNED",
                    );
                    const totalRow = managerBreakdown.reduce(
                      (acc, row) => {
                        const next: Record<PipelineStage, StageSummary> = {
                          ACCESS: acc.stages.ACCESS,
                          QUALIFIED: acc.stages.QUALIFIED,
                          EVALUATION: acc.stages.EVALUATION,
                          COMMITTED: acc.stages.COMMITTED,
                        };
                        for (const stage of PIPELINE_STAGES) {
                          const safe = safeStageCell(row.stages, stage);
                          next[stage] = {
                            count: next[stage].count + safe.count,
                            value: next[stage].value + safe.value,
                          };
                        }
                        return {
                          stages: next,
                          totalValue:
                            acc.totalValue +
                            (typeof row.totalValue === "number" && Number.isFinite(row.totalValue)
                              ? row.totalValue
                              : 0),
                        };
                      },
                      {
                        stages: {
                          ACCESS: ZERO_STAGE_SUMMARY,
                          QUALIFIED: ZERO_STAGE_SUMMARY,
                          EVALUATION: ZERO_STAGE_SUMMARY,
                          COMMITTED: ZERO_STAGE_SUMMARY,
                        },
                        totalValue: 0,
                      } as { stages: Record<PipelineStage, StageSummary>; totalValue: number },
                    );
                    return (
                      <>
                        <tr>
                          <td className="border p-2 font-semibold">TOTAL PIPELINE</td>
                          <td className="border p-2">{formatStageCell(safeStageCell(totalRow.stages, "ACCESS"))}</td>
                          <td className="border p-2">{formatStageCell(safeStageCell(totalRow.stages, "QUALIFIED"))}</td>
                          <td className="border p-2">{formatStageCell(safeStageCell(totalRow.stages, "EVALUATION"))}</td>
                          <td className="border p-2">{formatStageCell(safeStageCell(totalRow.stages, "COMMITTED"))}</td>
                          <td className="border p-2">{formatInr(totalRow.totalValue)}</td>
                          <td className="border p-2" />
                        </tr>
                        <tr>
                          <td className="p-2" colSpan={7} />
                        </tr>
                        {managerRows.map((row) => (
                          <Fragment key={row.managerId}>
                            <tr key={row.managerId}>
                              <td className="border p-2">{row.managerName}</td>
                              {PIPELINE_STAGES.map((stage) => {
                                const key = `mgr:${row.managerId}:${stage}`;
                                return (
                                  <td
                                    key={key}
                                    className="border p-2"
                                  >
                                    <div className="space-y-1">
                                      <div>{formatStageCell(safeStageCell(row.stages, stage))}</div>
                                      {renderDrilldownButton({
                                        keyId: key,
                                        stage,
                                        filters: { managerId: row.managerId },
                                        label: `${row.managerName} ${stage}`,
                                      })}
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="border p-2">{formatInr(row.totalValue)}</td>
                              <td className="border p-2 text-xs text-gray-500">Use stage buttons</td>
                            </tr>
                            {PIPELINE_STAGES.map((stage) => renderDealDrilldown(`mgr:${row.managerId}:${stage}`, 7))}
                          </Fragment>
                        ))}
                        {unassignedRow ? (
                          <Fragment key={unassignedRow.managerId}>
                            <tr key={unassignedRow.managerId}>
                              <td className="border p-2">{unassignedRow.managerName}</td>
                              {PIPELINE_STAGES.map((stage) => {
                                const key = `mgr:${unassignedRow.managerId}:${stage}`;
                                return (
                                  <td
                                    key={key}
                                    className="border p-2"
                                  >
                                    <div className="space-y-1">
                                      <div>{formatStageCell(safeStageCell(unassignedRow.stages, stage))}</div>
                                      {renderDrilldownButton({
                                        keyId: key,
                                        stage,
                                        filters: { unassigned: true },
                                        label: `${unassignedRow.managerName} ${stage}`,
                                      })}
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="border p-2">{formatInr(unassignedRow.totalValue)}</td>
                              <td className="border p-2 text-xs text-gray-500">Use stage buttons</td>
                            </tr>
                            {PIPELINE_STAGES.map((stage) =>
                              renderDealDrilldown(`mgr:${unassignedRow.managerId}:${stage}`, 7),
                            )}
                          </Fragment>
                        ) : null}
                      </>
                    );
                  })()}
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
                        <th className="border p-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED"] as const).map((stage) => {
                        const key = `rep:${rep.repId}:${stage}`;
                        return (
                          <Fragment key={key}>
                            <tr>
                              <td className="border p-2">{stage}</td>
                              <td className="border p-2">{rep.pipeline[stage].count}</td>
                              <td className="border p-2">{formatInr(rep.pipeline[stage].value)}</td>
                              <td className="border p-2">
                                {renderDrilldownButton({
                                  keyId: key,
                                  stage,
                                  filters: { ownerId: rep.repId },
                                  label: `${rep.repName} ${stage}`,
                                })}
                              </td>
                            </tr>
                            {renderDealDrilldown(key, 4)}
                          </Fragment>
                        );
                      })}
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
