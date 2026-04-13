"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatInr } from "@/lib/currency";
import { useTestSession } from "@/components/test-session-bar";

type DealValueEditorProps = {
  dealId: string;
  initialValue: number;
  canEdit: boolean;
};

export function DealValueEditor({ dealId, initialValue, canEdit }: DealValueEditorProps) {
  const router = useRouter();
  const { header } = useTestSession();
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(initialValue.toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function onSave() {
    setError("");
    setSuccess("");
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Value must be a positive number.");
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/deals/${dealId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...header,
      },
      body: JSON.stringify({ value: parsed }),
    });
    const body = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(body.error || "Failed to update value.");
      return;
    }

    setEditing(false);
    setSuccess("Deal value updated.");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p>Deal Value: {formatInr(initialValue)}</p>
      {canEdit ? (
        <div className="space-y-2">
          {!editing ? (
            <button
              type="button"
              className="inline-block rounded border px-3 py-1 text-sm"
              onClick={() => {
                setDraftValue(initialValue.toString());
                setError("");
                setSuccess("");
                setEditing(true);
              }}
            >
              Edit Value
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="w-40 rounded border px-2 py-1 text-sm"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
                onClick={() => void onSave()}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                onClick={() => {
                  setEditing(false);
                  setDraftValue(initialValue.toString());
                  setError("");
                }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}
      {success ? <p className="text-sm text-green-700">{success}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
