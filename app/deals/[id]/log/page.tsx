"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, KeyboardEvent, use, useEffect, useMemo, useState } from "react";
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

type UserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

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
  const [users, setUsers] = useState<UserOption[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantDropdownOpen, setParticipantDropdownOpen] = useState(false);
  const [activeParticipantIndex, setActiveParticipantIndex] = useState(0);
  const [participantsInitialized, setParticipantsInitialized] = useState(false);
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
      const needsParticipant = !hasParticipants;
      if (needsNextStep && needsRisk && needsParticipant) {
        setError("Please complete required next step fields, select at least one risk, and add a participant.");
      } else if (needsNextStep && needsRisk) {
        setError("Please complete required next step fields and select at least one risk.");
      } else if (needsNextStep && needsParticipant) {
        setError("Please complete required next step fields and add a participant.");
      } else if (needsRisk && needsParticipant) {
        setError("Please select at least one risk and add a participant.");
      } else if (needsNextStep) {
        setError("Please complete required next step fields.");
      } else if (needsRisk) {
        setError("Please select at least one risk.");
      } else if (needsParticipant) {
        setError("Please add at least one participant.");
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
      participants,
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

  function addParticipant(userId: string) {
    setParticipants((prev) => {
      if (prev.includes(userId)) return prev;
      return [...prev, userId];
    });
    setParticipantQuery("");
    setActiveParticipantIndex(0);
    setParticipantDropdownOpen(false);
  }

  function removeParticipant(userId: string) {
    setParticipants((prev) => prev.filter((id) => id !== userId));
  }

  function onParticipantKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && participantQuery === "" && participants.length > 0) {
      event.preventDefault();
      setParticipants((prev) => prev.slice(0, -1));
      return;
    }
    if (filteredParticipantOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setParticipantDropdownOpen(true);
      setActiveParticipantIndex((prev) => (prev + 1) % filteredParticipantOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setParticipantDropdownOpen(true);
      setActiveParticipantIndex((prev) =>
        prev === 0 ? filteredParticipantOptions.length - 1 : prev - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      addParticipant(filteredParticipantOptions[activeParticipantIndex]?.id ?? filteredParticipantOptions[0].id);
    }
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
  const hasParticipants = participants.length > 0;
  const canSubmit = hasRequiredRisks && hasRequiredNextStep && hasParticipants && !saving;
  const participantQueryLower = participantQuery.trim().toLowerCase();
  const selectedParticipantUsers = participants.map((participantId) => {
    const user = users.find((candidate) => candidate.id === participantId);
    if (user) return user;
    if (deal?.owner?.id === participantId) return deal.owner;
    if (deal?.coOwner?.id === participantId) {
      return {
        id: deal.coOwner.id,
        name: deal.coOwner.name,
        email: "",
        role: "CO_OWNER",
      };
    }
    return {
      id: participantId,
      name: "Unknown user",
      email: "",
      role: "",
    };
  });
  const filteredParticipantOptions = participantQueryLower
    ? users
        .filter((user) => !participants.includes(user.id))
        .filter((user) => user.name.toLowerCase().includes(participantQueryLower))
        .slice(0, 10)
    : [];

  useEffect(() => {
    if (!allowedRisksForStage) return;
    queueMicrotask(() => {
      setRisks((prev) => prev.filter((risk) => allowedRiskSet.has(risk)));
    });
  }, [allowedRiskSet, allowedRisksForStage]);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      try {
        const res = await fetch("/api/session/users");
        if (!res.ok) return;
        const data = (await res.json()) as UserOption[];
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    }
    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!deal?.ownerId || participantsInitialized) return;
    setParticipants(Array.from(new Set([deal.ownerId, deal.coOwnerId].filter(Boolean) as string[])));
    setParticipantsInitialized(true);
  }, [deal?.coOwnerId, deal?.ownerId, participantsInitialized]);

  useEffect(() => {
    setActiveParticipantIndex(0);
  }, [participantQuery]);

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
          <p className="block text-sm mb-1">Participants</p>
          <div className="relative rounded border bg-white px-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {selectedParticipantUsers.map((participant) => (
                <span
                  key={participant.id}
                  className="inline-flex items-center gap-1 rounded-full border bg-gray-50 px-2 py-1 text-xs"
                >
                  {participant.name}
                  {participant.role ? <span className="text-gray-500">({participant.role})</span> : null}
                  <button
                    type="button"
                    className="text-gray-500 hover:text-black"
                    aria-label={`Remove ${participant.name}`}
                    onClick={() => removeParticipant(participant.id)}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                type="text"
                className="min-w-40 flex-1 border-0 p-1 text-sm outline-none"
                placeholder={participants.length ? "Search users" : "Search participants by name"}
                value={participantQuery}
                onChange={(event) => {
                  setParticipantQuery(event.target.value);
                  setParticipantDropdownOpen(true);
                }}
                onFocus={() => setParticipantDropdownOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setParticipantDropdownOpen(false), 120);
                }}
                onKeyDown={onParticipantKeyDown}
                role="combobox"
                aria-expanded={participantDropdownOpen}
                aria-controls="participant-options"
              />
            </div>
            {participantDropdownOpen ? (
              <div
                id="participant-options"
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded border bg-white shadow"
              >
                {participantQuery.trim() === "" ? (
                  <p className="px-3 py-2 text-sm text-gray-500">Type a name to search users.</p>
                ) : filteredParticipantOptions.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-gray-500">No matching users.</p>
                ) : (
                  filteredParticipantOptions.map((user, index) => (
                    <button
                      key={user.id}
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        index === activeParticipantIndex ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                      onMouseEnter={() => setActiveParticipantIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addParticipant(user.id)}
                    >
                      <span className="font-medium">{user.name}</span>{" "}
                      <span className="text-xs text-gray-500">({user.role})</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-gray-500">Owner is included by default. Search to add reps or managers.</p>
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
