"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import { getPipelineQueryKey, getPipelineUrl, usePipeline } from "@/hooks/usePipeline";
import { apiGet } from "@/lib/api";
import { formatInr } from "@/lib/currency";
import { PRODUCT_OPTIONS } from "@/lib/products";

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
  outcomes: OutcomeSummary;
};
type PersonalPipeline = {
  pipeline: PipelineTotals;
  outcomes: OutcomeSummary;
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
type TotalPipelineAccumulator = Omit<ManagerBreakdownRow, "managerId" | "managerName">;

type PipelineResponse = PipelineTotals | {
  pipeline?: PipelineTotals;
  totals: PipelineTotals;
  outcomes: OutcomeSummary;
  repPipelines: ManagerRepPipeline[];
  personalPipeline?: PersonalPipeline;
  managerBreakdown?: ManagerBreakdownRow[];
};
type PipelineStage = keyof PipelineTotals;
type DrilldownStage = PipelineStage | keyof OutcomeSummary;
type DrilldownStageRequest = DrilldownStage | DrilldownStage[];
const PIPELINE_STAGES: PipelineStage[] = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED"];
const ZERO_STAGE_SUMMARY: StageSummary = { count: 0, value: 0 };
const EMPTY_PIPELINE_TOTALS: PipelineTotals = {
  ACCESS: { ...ZERO_STAGE_SUMMARY },
  QUALIFIED: { ...ZERO_STAGE_SUMMARY },
  EVALUATION: { ...ZERO_STAGE_SUMMARY },
  COMMITTED: { ...ZERO_STAGE_SUMMARY },
};
const EMPTY_OUTCOMES: OutcomeSummary = {
  CLOSED: { ...ZERO_STAGE_SUMMARY },
  LOST: { ...ZERO_STAGE_SUMMARY },
};
type DrilldownDeal = {
  id: string;
  value: number;
  stage: string;
  lastActivityAt: string;
  expiryWarning?: "EXPIRED" | "EXPIRING_SOON" | null;
  daysToExpiry?: number | null;
  account: { name: string };
};
type DrilldownState = {
  loading: boolean;
  error: string;
  deals: DrilldownDeal[];
};
type DrilldownFilters = { ownerId?: string; managerId?: string; unassigned?: boolean };

export default function PipelinePage() {
  const { currentUser } = useTestSession();
  const queryClient = useQueryClient();
  const [data, setData] = useState<PipelineTotals | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeSummary | null>(null);
  const [repPipelines, setRepPipelines] = useState<ManagerRepPipeline[]>([]);
  const [personalPipeline, setPersonalPipeline] = useState<PersonalPipeline | null>(null);
  const [managerBreakdown, setManagerBreakdown] = useState<ManagerBreakdownRow[]>([]);
  const [error, setError] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [drilldownByKey, setDrilldownByKey] = useState<Record<string, DrilldownState>>({});
  const [selectedProduct, setSelectedProduct] = useState("");
  usePipeline({ product: selectedProduct, enabled: false });

  async function loadPipeline(productOverride = selectedProduct) {
    setError("");
    setExpandedKey(null);
    setDrilldownByKey({});
    let body: PipelineResponse;
    try {
      body = await queryClient.fetchQuery({
        queryKey: getPipelineQueryKey(productOverride),
        queryFn: () => apiGet<PipelineResponse>(getPipelineUrl(productOverride)),
      });
    } catch {
      setError("Failed to load pipeline");
      return;
    }
    if ("totals" in (body as PipelineResponse)) {
      const typed = body as {
        pipeline?: PipelineTotals;
        totals: PipelineTotals;
        outcomes: OutcomeSummary;
        repPipelines: ManagerRepPipeline[];
        personalPipeline?: PersonalPipeline;
        managerBreakdown?: ManagerBreakdownRow[];
      };
      setData(typed.totals ?? typed.pipeline ?? null);
      setOutcomes(typed.outcomes ?? null);
      if (currentUser?.role === "ADMIN") {
        setRepPipelines([]);
        setPersonalPipeline(null);
        setManagerBreakdown(typed.managerBreakdown ?? []);
        return;
      }
      if (currentUser?.role === "MANAGER") {
        setPersonalPipeline(typed.personalPipeline ?? null);
      } else {
        setPersonalPipeline(null);
      }
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
      setPersonalPipeline(null);
    }
    setPersonalPipeline(null);
    setManagerBreakdown([]);
  }

  function renderDealDrilldown(key: string, colSpan: number) {
    if (expandedKey !== key) return null;
    const state = drilldownByKey[key];
    return (
      <tr key={key}>
        <td className="border p-2 bg-gray-50 text-center" colSpan={colSpan}>
          {!state || state.loading ? (
            <p className="text-sm text-gray-600">Loading deals...</p>
          ) : state.error ? (
            <p className="text-sm text-red-600">{state.error}</p>
          ) : state.deals.length === 0 ? (
            <p className="text-sm text-gray-600">No deals found for this stage.</p>
          ) : (
            <div className="divide-y">
              {state.deals.map((deal, index) => (
                <div key={deal.id} className="text-sm flex flex-wrap justify-center gap-4 py-2">
                  <span className="w-8 shrink-0 text-gray-500">{index + 1}.</span>
                  <span className="font-medium">{deal.account.name}</span>
                  <span>{formatInr(deal.value)}</span>
                  <span>{deal.stage}</span>
                  <span className="text-gray-600">
                    Last activity:{" "}
                    {deal.lastActivityAt ? new Date(deal.lastActivityAt).toLocaleString() : "N/A"}
                  </span>
                  {deal.expiryWarning === "EXPIRING_SOON" && typeof deal.daysToExpiry === "number" ? (
                    <span className="rounded border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                      ⚠️ Expiring in {deal.daysToExpiry} day
                      {deal.daysToExpiry === 1 ? "" : "s"}
                    </span>
                  ) : null}
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
    stage: DrilldownStageRequest;
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
    stage: DrilldownStageRequest,
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
    const params = new URLSearchParams();
    if (Array.isArray(stage)) {
      params.set("stages", stage.join(","));
    } else {
      params.set("stage", stage);
    }
    if (filters?.ownerId) params.set("ownerId", filters.ownerId);
    if (filters?.managerId) params.set("managerId", filters.managerId);
    if (filters?.unassigned) params.set("unassigned", "1");
    if (selectedProduct) params.set("product", selectedProduct);
    let body: unknown;
    try {
      body = await apiGet(`/api/deals?${params.toString()}`);
    } catch {
      setDrilldownByKey((prev) => ({
        ...prev,
        [key]: { loading: false, error: "Failed to load deals", deals: [] },
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
              <th className="border p-2 text-center">Stage</th>
              <th className="border p-2 text-center">Count</th>
              <th className="border p-2 text-center">Deal Value</th>
              <th className="border p-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => {
              const key = `main:${stage}`;
              return (
                <Fragment key={key}>
                  <tr>
                    <td className="border p-2 text-center">{stage}</td>
                    <td className="border p-2 text-center">{source[stage].count}</td>
                    <td className="border p-2 text-center">{formatInr(source[stage].value)}</td>
                    <td className="border p-2 text-center">
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

  function formatStageCell(summary: StageSummary | null | undefined) {
    const safe = {
      count: typeof summary?.count === "number" && Number.isFinite(summary.count) ? summary.count : 0,
      value: typeof summary?.value === "number" && Number.isFinite(summary.value) ? summary.value : 0,
    };
    return `${safe.count} deal${safe.count === 1 ? "" : "s"}`;
  }

  function sumStageSummaries(...summaries: StageSummary[]): StageSummary {
    return summaries.reduce(
      (acc, summary) => ({
        count: acc.count + summary.count,
        value: acc.value + summary.value,
      }),
      { count: 0, value: 0 },
    );
  }

  function renderStageCell(params: {
    rowId: string;
    stage: DrilldownStage;
    summary: StageSummary;
    filters?: DrilldownFilters;
  }) {
    const key = `${params.rowId}:${params.stage}`;
    return (
      <td className="border p-2 text-center align-top">
        <div className="space-y-2">
          <button
            type="button"
            className="font-semibold underline underline-offset-2 hover:text-gray-700"
            onClick={() => void toggleDrilldown(key, params.stage, params.filters)}
          >
            {formatInr(params.summary.value)}
          </button>
          <div className="text-xs text-gray-500">{formatStageCell(params.summary)}</div>
          {renderDrilldownButton({
            keyId: key,
            stage: params.stage,
            filters: params.filters,
            label: params.stage,
          })}
        </div>
      </td>
    );
  }

  function renderManagerPipelineRow(params: {
    row: ManagerBreakdownRow;
    rowId: string;
    labelClassName?: string;
    filters?: DrilldownFilters;
  }) {
    const { row, rowId, filters } = params;
    return (
      <tr>
        <td className={`border p-2 text-center align-top ${params.labelClassName ?? ""}`}>{row.managerName}</td>
        {renderStageCell({
          rowId,
          stage: "ACCESS",
          summary: safeStageCell(row.stages, "ACCESS"),
          filters,
        })}
        {renderStageCell({
          rowId,
          stage: "QUALIFIED",
          summary: safeStageCell(row.stages, "QUALIFIED"),
          filters,
        })}
        {renderStageCell({
          rowId,
          stage: "EVALUATION",
          summary: safeStageCell(row.stages, "EVALUATION"),
          filters,
        })}
        {renderStageCell({
          rowId,
          stage: "COMMITTED",
          summary: safeStageCell(row.stages, "COMMITTED"),
          filters,
        })}
        {renderStageCell({
          rowId,
          stage: "CLOSED",
          summary: row.outcomes.CLOSED,
          filters,
        })}
        {renderStageCell({
          rowId,
          stage: "LOST",
          summary: row.outcomes.LOST,
          filters,
        })}
      </tr>
    );
  }

  function renderAdminDealDrilldowns(rowId: string, colSpan: number) {
    return (
      <>
        {renderDealDrilldown(`${rowId}:ACCESS`, colSpan)}
        {renderDealDrilldown(`${rowId}:QUALIFIED`, colSpan)}
        {renderDealDrilldown(`${rowId}:EVALUATION`, colSpan)}
        {renderDealDrilldown(`${rowId}:COMMITTED`, colSpan)}
        {renderDealDrilldown(`${rowId}:CLOSED`, colSpan)}
        {renderDealDrilldown(`${rowId}:LOST`, colSpan)}
      </>
    );
  }

  function renderSixStagePipelineTable(params: {
    rowId: string;
    pipeline: PipelineTotals;
    outcomes: OutcomeSummary;
    filters: DrilldownFilters;
  }) {
    return (
      <table className="w-full border-collapse border text-sm">
        <thead>
          <tr>
            <th className="border p-2 text-center">Access</th>
            <th className="border p-2 text-center">Qualified</th>
            <th className="border p-2 text-center">Evaluation</th>
            <th className="border p-2 text-center">Committed</th>
            <th className="border p-2 text-center">Closed Success</th>
            <th className="border p-2 text-center">Lost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {renderStageCell({
              rowId: params.rowId,
              stage: "ACCESS",
              summary: params.pipeline.ACCESS,
              filters: params.filters,
            })}
            {renderStageCell({
              rowId: params.rowId,
              stage: "QUALIFIED",
              summary: params.pipeline.QUALIFIED,
              filters: params.filters,
            })}
            {renderStageCell({
              rowId: params.rowId,
              stage: "EVALUATION",
              summary: params.pipeline.EVALUATION,
              filters: params.filters,
            })}
            {renderStageCell({
              rowId: params.rowId,
              stage: "COMMITTED",
              summary: params.pipeline.COMMITTED,
              filters: params.filters,
            })}
            {renderStageCell({
              rowId: params.rowId,
              stage: "CLOSED",
              summary: params.outcomes.CLOSED,
              filters: params.filters,
            })}
            {renderStageCell({
              rowId: params.rowId,
              stage: "LOST",
              summary: params.outcomes.LOST,
              filters: params.filters,
            })}
          </tr>
          {renderAdminDealDrilldowns(params.rowId, 6)}
        </tbody>
      </table>
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

      <section className="border rounded-lg p-4 space-y-2">
        <label className="block text-sm font-medium" htmlFor="pipeline-product-filter">
          Filter by Product
        </label>
        <select
          id="pipeline-product-filter"
          className="w-full max-w-sm rounded border px-3 py-2 text-sm"
          value={selectedProduct}
          onChange={(e) => {
            const product = e.target.value;
            setSelectedProduct(product);
            void loadPipeline(product);
          }}
        >
          <option value="">All Products</option>
          {PRODUCT_OPTIONS.map((product) => (
            <option key={product} value={product}>
              {product}
            </option>
          ))}
        </select>
        {selectedProduct ? (
          <p className="text-sm text-gray-700">Showing pipeline for: {selectedProduct}</p>
        ) : null}
      </section>

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
                    <th className="border p-2 text-center">Stage</th>
                    <th className="border p-2 text-center">Count</th>
                    <th className="border p-2 text-center">Deal Value</th>
                    <th className="border p-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(["CLOSED", "LOST"] as const).map((stage) => {
                    const key = `outcome:${stage}`;
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td className="border p-2 text-center">{stage}</td>
                          <td className="border p-2 text-center">{outcomes[stage].count}</td>
                          <td className="border p-2 text-center">{formatInr(outcomes[stage].value)}</td>
                          <td className="border p-2 text-center">
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] border-collapse border text-sm">
                  <thead>
                    <tr>
                      <th className="border p-2 text-center" rowSpan={2}>Manager</th>
                      <th className="border p-2 text-center" colSpan={2}>Early Funnel</th>
                      <th className="border p-2 text-center" colSpan={2}>Mid Stage</th>
                      <th className="border p-2 text-center" rowSpan={2}>Closed Success</th>
                      <th className="border p-2 text-center" rowSpan={2}>Lost</th>
                    </tr>
                    <tr>
                      <th className="border p-2 text-center text-xs font-normal text-gray-500">Access</th>
                      <th className="border p-2 text-center text-xs font-normal text-gray-500">Qualified</th>
                      <th className="border p-2 text-center text-xs font-normal text-gray-500">Evaluation</th>
                      <th className="border p-2 text-center text-xs font-normal text-gray-500">Committed</th>
                    </tr>
                  </thead>
                <tbody>
                  {(() => {
                    const unassignedRow =
                      managerBreakdown.find((row) => row.managerId === "UNASSIGNED") ?? null;
                    const managerRows = managerBreakdown.filter(
                      (row) => row.managerId !== "UNASSIGNED",
                    );
                    const totalRow = managerBreakdown.reduce<TotalPipelineAccumulator>(
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
                        const closed = sumStageSummaries(
                          acc.outcomes.CLOSED,
                          row.outcomes.CLOSED,
                        );
                        const lost = sumStageSummaries(acc.outcomes.LOST, row.outcomes.LOST);
                        return {
                          stages: next,
                          totalValue:
                            acc.totalValue +
                            (typeof row.totalValue === "number" && Number.isFinite(row.totalValue)
                              ? row.totalValue
                              : 0),
                          outcomes: { CLOSED: closed, LOST: lost },
                        };
                      },
                      {
                        stages: {
                          ACCESS: { ...ZERO_STAGE_SUMMARY },
                          QUALIFIED: { ...ZERO_STAGE_SUMMARY },
                          EVALUATION: { ...ZERO_STAGE_SUMMARY },
                          COMMITTED: { ...ZERO_STAGE_SUMMARY },
                        },
                        outcomes: {
                          CLOSED: { ...ZERO_STAGE_SUMMARY },
                          LOST: { ...ZERO_STAGE_SUMMARY },
                        },
                        totalValue: 0,
                      },
                    );
                    return (
                      <>
                        {renderManagerPipelineRow({
                          row: {
                            managerId: "TOTAL",
                            managerName: "TOTAL PIPELINE",
                            ...totalRow,
                          },
                          rowId: "total",
                          labelClassName: "font-semibold",
                        })}
                        {renderAdminDealDrilldowns("total", 7)}
                        <tr>
                          <td className="p-2 text-center" colSpan={7} />
                        </tr>
                        {managerRows.map((row) => (
                          <Fragment key={row.managerId}>
                            {renderManagerPipelineRow({
                              row,
                              rowId: `mgr:${row.managerId}`,
                              filters: { managerId: row.managerId },
                            })}
                            {renderAdminDealDrilldowns(`mgr:${row.managerId}`, 7)}
                          </Fragment>
                        ))}
                        {unassignedRow ? (
                          <Fragment key={unassignedRow.managerId}>
                            {renderManagerPipelineRow({
                              row: unassignedRow,
                              rowId: "mgr:UNASSIGNED",
                              filters: { unassigned: true },
                            })}
                            {renderAdminDealDrilldowns("mgr:UNASSIGNED", 7)}
                          </Fragment>
                        ) : null}
                      </>
                    );
                  })()}
                </tbody>
                </table>
              </div>
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
                  {renderSixStagePipelineTable({
                    rowId: `rep:${rep.repId}`,
                    pipeline: rep.pipeline,
                    outcomes: rep.outcomes,
                    filters: { ownerId: rep.repId },
                  })}
                </div>
              ))}
              {repPipelines.length === 0 ? (
                <p className="text-sm text-gray-600">No direct reports found.</p>
              ) : null}
            </section>
          ) : null}

          {currentUser?.role === "MANAGER" ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">My Personal Pipeline</h2>
              <div className="border rounded-lg p-4 space-y-2">
                {renderSixStagePipelineTable({
                  rowId: `personal:${currentUser.id}`,
                  pipeline: personalPipeline?.pipeline ?? EMPTY_PIPELINE_TOTALS,
                  outcomes: personalPipeline?.outcomes ?? EMPTY_OUTCOMES,
                  filters: { ownerId: currentUser.id },
                })}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
