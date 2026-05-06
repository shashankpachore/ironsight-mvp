"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteEntityButtonProps = {
  entityId: string;
  entityType: "deal" | "account";
  redirectPath?: string;
  confirmationMessage: string;
  successMessage: string;
  isAdmin: boolean;
};

export function DeleteEntityButton({
  entityId,
  entityType,
  redirectPath,
  confirmationMessage,
  successMessage,
  isAdmin,
}: DeleteEntityButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      const endpoint = entityType === "deal" ? `/api/deals/${entityId}` : `/api/accounts/${entityId}`;
      const res = await fetch(endpoint, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }

      alert(successMessage);
      if (redirectPath) {
        router.push(redirectPath);
        router.refresh();
      } else {
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="rounded border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
        disabled={isDeleting}
      >
        {isDeleting ? "Deleting..." : `Delete ${entityType === "deal" ? "Deal" : "Account"}`}
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Confirm Deletion</h3>
            <p className="mt-2 text-sm text-gray-600">{confirmationMessage}</p>
            
            {error && (
              <p className="mt-3 text-sm text-red-600 font-medium">Error: {error}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                disabled={isDeleting}
              >
                {isDeleting ? "Archiving..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
