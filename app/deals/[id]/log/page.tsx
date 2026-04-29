"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, use, useEffect, useMemo, useState } from "react";
import { useDeal } from "@/hooks/useDeal";
import { useInteractionLogs } from "@/hooks/useInteractionLogs";
import { apiPost } from "@/lib/api";
import {
  type DealStage,
  INTERACTION_TYPES,
  OUTCOME_GROUPS,
  OUTCOME_LABELS,
  OUTCOMES,
  type RiskCategoryValue,
  RISK_GROUPS,
  RISK_LABELS,
  STAGE_RISK_MAP,
  STAKEHOLDER_TYPES,
} from "@/lib/domain";
import { istYmdToUtcStart } from "@/lib/ist-time";
import { getDealStageFromOutcomes } from "@/lib/logic/stage";
import {
  NEXT_STEP_OPTIONS,
  type NextStepTypeValue,
} from "@/lib/next-step";
import {
  getSuggestedNextStepDate,
  getSuggestedNextStepType,
  RISK_SUGGESTIONS,
} from "@/lib/suggestions";

export default function LogInteractionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [interactionType] = useState<
    (typeof INTERACTION_TYPES)[number]
  >(INTERACTION_TYPES[0]);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>(OUTCOMES[0]);
  const initialNextStep = getSuggestedNextStepType(OUTCOMES[0]);
  const [nextStepType, setNextStepType] = useState<NextStepTypeValue | "">(
    initialNextStep ?? "",
  );
  const [nextStepDateYmd, setNextStepDateYmd] = useState(() =>
    getSuggestedNextStepDate(OUTCOMES[0]),
  );
  const [nextStepManuallyChanged, setNextStepManuallyChanged] = useState(false);
  const [stakeholderType, setStakeholderType] = useState<
    (typeof STAKEHOLDER_TYPES)[number]
  >(STAKEHOLDER_TYPES[0]);
  const [risks, setRisks] = useState<RiskCategoryValue[]>([]);
  const [risksManuallyChanged, setRisksManuallyChanged] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: deal } = useDeal(id);
  const { data: interactionLogs } = useInteractionLogs(id);

  const postLogStage = useMemo<DealStage | null>(() => {
    if (!interactionLogs) return null;
    return getDealStageFromOutcomes([
      ...interactionLogs.map((log) => log.outcome),
      outcome,
    ]);
  }, [interactionLogs, outcome]);

  function applyOutcomeSuggestion(nextOutcome: (typeof OUTCOMES)[number]) {
    if (nextOutcome === "PO_RECEIVED") {
      setNextStepType("");
      setNextStepDateYmd("");
      return;
    }

    if (!nextStepManuallyChanged) {
      setNextStepType(getSuggestedNextStepType(nextOutcome) ?? "");
      setNextStepDateYmd(getSuggestedNextStepDate(nextOutcome));
    }

    if (!risksManuallyChanged) {
      setRisks(RISK_SUGGESTIONS[nextOutcome] ?? []);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      const needsNextStep = requiresNextStep && !hasRequiredNextStep;
      const needsRisk = requiresRisks && !hasRequiredRisks;
      if (needsNextStep && needsRisk) {
        setError("Please complete required next step fields and select at least one risk.");
      } else if (needsNextStep) {
        setError("Please complete required next step fields.");
      } else if (needsRisk) {
        setError("Please select at least one risk.");
      } else {
        setError("Please complete required fields.");
      }
      return;
    }
    setSaving(true);
    setError("");
    const payload: Record<string, unknown> = {
      dealId: id,
      interactionType,
      outcome,
      stakeholderType,
      risks,
      notes: notes || undefined,
      nextStepSource: nextStepManuallyChanged ? "MANUAL" : "AUTO",
    };
    if (requiresNextStep) {
      payload.nextStepType = nextStepType || undefined;
      payload.nextStepDate = istYmdToUtcStart(nextStepDateYmd).toISOString();
    }

    try {
      await apiPost("/api/logs", payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["interactionLogs", id] }),
        queryClient.invalidateQueries({ queryKey: ["deal", id] }),
      ]);
    } catch {
      setError("Failed to save log");
      setSaving(false);
      return;
    }

    router.push(`/deals/${id}`);
    router.refresh();
  }

  function toggleRisk(value: RiskCategoryValue) {
    setRisksManuallyChanged(true);
    setRisks((prev) => {
      if (prev.includes(value)) return prev.filter((x) => x !== value);
      if (prev.length >= 3) return prev;
      return [...prev, value];
    });
  }

  const requiresNextStep = outcome !== "PO_RECEIVED";
  const activeStage = postLogStage;
  const allowedRisksForStage = activeStage ? STAGE_RISK_MAP[activeStage] : null;
  const allowedRiskSet = useMemo(
    () => new Set<RiskCategoryValue>(allowedRisksForStage ?? []),
    [allowedRisksForStage],
  );
  const requiresRisks =
    activeStage === "EVALUATION" || activeStage === "COMMITTED" || activeStage === "LOST";
  const risksNotAllowed = activeStage === "CLOSED";
  const visibleRiskGroups = RISK_GROUPS.map((group) => ({
    ...group,
    values: allowedRisksForStage
      ? group.values.filter((risk) => allowedRiskSet.has(risk))
      : group.values,
  })).filter((group) => group.values.length > 0);
  const hasRequiredNextStep = requiresNextStep
    ? Boolean(nextStepType) && Boolean(nextStepDateYmd)
    : true;
  const hasRequiredRisks = requiresRisks ? risks.length >= 1 : true;
  const hasDisallowedRisks = risksNotAllowed ? risks.length > 0 : false;
  const canSubmit = hasRequiredRisks && hasRequiredNextStep && !saving;

  useEffect(() => {
    if (!allowedRisksForStage) return;
    queueMicrotask(() => {
      setRisks((prev) => prev.filter((risk) => allowedRiskSet.has(risk)));
    });
  }, [allowedRiskSet, allowedRisksForStage]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold mb-4">Log Interaction</h1>
      {deal?.expiryWarning === "EXPIRING_SOON" &&
      typeof deal.daysToExpiry === "number" ? (
        <section className="mb-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-orange-800">
          ⚠️ This deal will expire in {deal.daysToExpiry} day
          {deal.daysToExpiry === 1 ? "" : "s"} due to inactivity. Log an interaction to keep it active.
        </section>
      ) : null}
      <form onSubmit={onSubmit} className="border rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-sm mb-1">Outcome</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={outcome}
            onChange={(e) => {
              const v = e.target.value as (typeof OUTCOMES)[number];
              setOutcome(v);
              applyOutcomeSuggestion(v);
            }}
          >
            {OUTCOME_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.values.map((value) => (
                  <option key={value} value={value}>
                    {OUTCOME_LABELS[value]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="border rounded p-3 space-y-3 bg-gray-50">
          <p className="text-sm font-medium">Next step (required)</p>
          <p className="text-xs text-gray-500">Suggested based on outcome</p>
          <div>
            <label className="block text-sm mb-1">Next step</label>
            <select
              className="w-full border rounded px-3 py-2 bg-white"
              value={nextStepType}
              disabled={outcome === "PO_RECEIVED"}
              onChange={(e) => {
                setNextStepType(e.target.value as NextStepTypeValue | "");
                setNextStepManuallyChanged(true);
              }}
            >
              <option value="">Select next step</option>
              {NEXT_STEP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2 bg-white"
              value={nextStepDateYmd}
              disabled={outcome === "PO_RECEIVED"}
              required
              onChange={(e) => {
                setNextStepDateYmd(e.target.value);
                setNextStepManuallyChanged(true);
              }}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">Notes (optional)</label>
          <textarea
            className="w-full border rounded px-3 py-2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Stakeholder</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={stakeholderType}
            onChange={(e) =>
              setStakeholderType(e.target.value as (typeof STAKEHOLDER_TYPES)[number])
            }
          >
            {STAKEHOLDER_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          {risksNotAllowed ? (
            <p className="text-sm text-gray-500">Risks are not allowed when the deal is in CLOSED stage.</p>
          ) : requiresRisks ? (
            <>
              <p className="block text-sm mb-1">Risks (min 1, max 3)</p>
              <div className="space-y-3">
                {visibleRiskGroups.map((group) => (
                  <div key={group.label} className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                      {group.label}
                    </p>
                    <div className="grid md:grid-cols-2 gap-2">
                      {group.values.map((risk) => (
                        <label key={risk} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={risks.includes(risk)}
                            onChange={() => toggleRisk(risk)}
                          />
                          {RISK_LABELS[risk]}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">Suggested based on outcome</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              Risks are optional for {activeStage ?? "this stage"}.
            </p>
          )}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={!canSubmit || hasDisallowedRisks}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Interaction"}
        </button>
      </form>
    </main>
  );
}
