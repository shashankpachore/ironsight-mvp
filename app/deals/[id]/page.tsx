import Link from "next/link";
import { cookies } from "next/headers";
import { UserRole } from "@prisma/client";
import { DealValueEditor } from "@/components/deal-value-editor";
import { getDealStageFromLogs } from "@/lib/deals";
import { NEXT_STEP_LABELS, type NextStepTypeValue } from "@/lib/next-step";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const selectedUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = selectedUserId
    ? await prisma.user.findUnique({
        where: { id: selectedUserId },
        select: { id: true, role: true },
      })
    : null;
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      account: true,
      owner: { select: { id: true, name: true, managerId: true } },
      coOwner: { select: { id: true, name: true } },
      logs: {
        include: {
          risks: true,
          participants: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!deal) return <main className="p-6">Deal not found.</main>;
  const stage = getDealStageFromLogs(deal.logs);
  const canEditValue =
    currentUser?.role === UserRole.ADMIN ||
    currentUser?.id === deal.ownerId ||
    (currentUser?.role === UserRole.MANAGER && deal.owner.managerId === currentUser.id);

  const nextActionLabel =
    deal.nextStepType && deal.nextStepDate
      ? `${NEXT_STEP_LABELS[deal.nextStepType as NextStepTypeValue] ?? deal.nextStepType}`
      : null;
  const nextActionWhen =
    deal.nextStepDate?.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
    }) ?? null;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <Link href="/" className="text-sm underline">
        Back to deals
      </Link>
      <section className="border rounded-lg p-4 space-y-2">
        <h1 className="text-2xl font-semibold">{deal.account.name}</h1>
        <p className="text-sm text-gray-700">Product: {deal.name}</p>
        <p className="text-sm text-gray-700">Owner (primary, accountable): {deal.owner.name}</p>
        {deal.coOwner ? (
          <p className="text-sm text-gray-700">Co-owner (execution support): {deal.coOwner.name}</p>
        ) : null}

        <div className="border rounded p-3">
          <p className="text-sm font-medium">Next Action</p>
          {nextActionLabel && nextActionWhen ? (
            <p className="text-sm mt-1">
              🔥 Next: {nextActionLabel} ({nextActionWhen})
            </p>
          ) : (
            <p className="text-sm mt-1">No next action set.</p>
          )}
        </div>

        <DealValueEditor
          dealId={deal.id}
          initialValue={deal.value}
          canEdit={Boolean(canEditValue)}
        />

        <p className="text-sm">Stage: {stage}</p>
        <p className="text-sm">Last activity: {deal.lastActivityAt.toLocaleString()}</p>

        <Link
          href={`/deals/${deal.id}/log`}
          className="inline-block mt-3 rounded bg-black px-3 py-2 text-white"
        >
          Log Interaction
        </Link>
      </section>

      <section className="border rounded-lg p-4">
        <details>
          <summary className="font-medium">Interaction Timeline</summary>
          <div className="space-y-3 mt-3">
            {deal.logs.map((log) => (
              <div key={log.id} className="border rounded p-3">
                <p className="text-sm">{new Date(log.createdAt).toLocaleString()}</p>
                <p className="text-sm">Type: {log.interactionType}</p>
                <p className="text-sm">Outcome: {log.outcome}</p>
                <p className="text-sm">Stakeholder: {log.stakeholderType}</p>
                <p className="text-sm">
                  Participants:{" "}
                  {log.participants.length
                    ? log.participants.map((participant) => participant.user.name).join(", ")
                    : "None"}
                </p>
                <p className="text-sm">
                  Risks: {log.risks.map((r) => r.category).join(", ")}
                </p>
                {log.notes ? <p className="text-sm">Notes: {log.notes}</p> : null}
              </div>
            ))}
            {deal.logs.length === 0 ? <p>No interactions logged yet.</p> : null}
          </div>
        </details>
      </section>
    </main>
  );
}
