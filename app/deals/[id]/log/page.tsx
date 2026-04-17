"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import {
  INTERACTION_TYPES,
  OUTCOME_GROUPS,
  OUTCOME_LABELS,
  OUTCOMES,
  type RiskCategoryValue,
  RISK_GROUPS,
  RISK_LABELS,
  STAKEHOLDER_TYPES,
} from "@/lib/domain";
import { istYmdToUtcStart } from "@/lib/ist-time";
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
  const router = useRouter();
  const { header } = useTestSession();
  const [interactionType, setInteractionType] = useState<
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
      setError("Please complete required next step fields and select at least one risk.");
      return;
    }
    setSaving(true);
    setError("");
    const { id } = await params;

    const res = await fetch("/api/logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({
        dealId: id,
        interactionType,
        outcome,
        stakeholderType,
        risks,
        notes: notes || undefined,
        nextStepType: nextStepType || undefined,
        nextStepDate: istYmdToUtcStart(nextStepDateYmd).toISOString(),
        nextStepSource: nextStepManuallyChanged ? "MANUAL" : "AUTO",
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to save log");
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

  const canSubmit =
    risks.length >= 1 && Boolean(nextStepType) && Boolean(nextStepDateYmd) && !saving;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold mb-4">Log Interaction</h1>
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
          <p className="block text-sm mb-1">Risks (min 1, max 3)</p>
          <div className="space-y-3">
            {RISK_GROUPS.map((group) => (
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
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Interaction"}
        </button>
      </form>
    </main>
  );
}
