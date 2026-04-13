"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useTestSession } from "@/components/test-session-bar";
import {
  INTERACTION_TYPES,
  OUTCOMES,
  RISK_CATEGORIES,
  STAKEHOLDER_TYPES,
} from "@/lib/domain";
import { istYmdToUtcStart } from "@/lib/ist-time";
import {
  getDefaultNextStepDateYmd,
  getSuggestedNextStep,
  NEXT_STEP_OPTIONS,
  type NextStepTypeValue,
} from "@/lib/next-step";

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
  const initialSuggest = getSuggestedNextStep(OUTCOMES[0]);
  const [nextStepType, setNextStepType] = useState<NextStepTypeValue>(initialSuggest.type);
  const [nextStepDateYmd, setNextStepDateYmd] = useState(() =>
    getDefaultNextStepDateYmd(initialSuggest.defaultDays),
  );
  const [nextStepNote, setNextStepNote] = useState("");
  const [nextStepManual, setNextStepManual] = useState(false);
  const [stakeholderType, setStakeholderType] = useState<
    (typeof STAKEHOLDER_TYPES)[number]
  >(STAKEHOLDER_TYPES[0]);
  const [risks, setRisks] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function applyOutcomeSuggestion(nextOutcome: string) {
    const s = getSuggestedNextStep(nextOutcome);
    setNextStepType(s.type);
    setNextStepDateYmd(getDefaultNextStepDateYmd(s.defaultDays));
    setNextStepManual(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
        nextStepType,
        nextStepDate: istYmdToUtcStart(nextStepDateYmd).toISOString(),
        nextStepNote: nextStepNote.trim() || undefined,
        nextStepSource: nextStepManual ? "MANUAL" : "AUTO",
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

  function toggleRisk(value: string) {
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
          <label className="block text-sm mb-1">Interaction Type</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={interactionType}
            onChange={(e) => setInteractionType(e.target.value as (typeof INTERACTION_TYPES)[number])}
          >
            {INTERACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
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
            {OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="border rounded p-3 space-y-3 bg-gray-50">
          <p className="text-sm font-medium">Next step (required)</p>
          <div>
            <label className="block text-sm mb-1">Next step</label>
            <select
              className="w-full border rounded px-3 py-2 bg-white"
              value={nextStepType}
              onChange={(e) => {
                setNextStepType(e.target.value as NextStepTypeValue);
                setNextStepManual(true);
              }}
            >
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
              required
              onChange={(e) => {
                setNextStepDateYmd(e.target.value);
                setNextStepManual(true);
              }}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Note (optional)</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2 bg-white"
              value={nextStepNote}
              onChange={(e) => {
                setNextStepNote(e.target.value);
                setNextStepManual(true);
              }}
              placeholder="Optional"
            />
          </div>
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
          <div className="grid md:grid-cols-2 gap-2">
            {RISK_CATEGORIES.map((risk) => (
              <label key={risk} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={risks.includes(risk)}
                  onChange={() => toggleRisk(risk)}
                />
                {risk}
              </label>
            ))}
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
