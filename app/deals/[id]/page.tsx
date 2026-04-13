import Link from "next/link";
import { cookies } from "next/headers";
import { UserRole } from "@prisma/client";
import { DealValueEditor } from "@/components/deal-value-editor";
import { getDealStage, getMissingSignals } from "@/lib/deals";
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
      owner: { select: { id: true, managerId: true } },
      logs: {
        include: { risks: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!deal) return <main className="p-6">Deal not found.</main>;
  const [stage, missingSignals] = await Promise.all([
    getDealStage(id),
    getMissingSignals(id),
  ]);
  const canEditValue =
    currentUser?.role === UserRole.ADMIN ||
    currentUser?.id === deal.ownerId ||
    (currentUser?.role === UserRole.MANAGER && deal.owner.managerId === currentUser.id);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <Link href="/" className="text-sm underline">
        Back to deals
      </Link>
      <section className="border rounded-lg p-4 space-y-1">
        <h1 className="text-2xl font-semibold">{deal.account.name}</h1>
        <p className="text-sm text-gray-700">Product: {deal.name}</p>
        <DealValueEditor
          dealId={deal.id}
          initialValue={deal.value}
          canEdit={Boolean(canEditValue)}
        />
        <p>Stage: {stage}</p>
        <p>Last activity: {deal.lastActivityAt.toLocaleString()}</p>
        <p>
          Missing signals:{" "}
          {missingSignals.length ? missingSignals.join(", ") : "None"}
        </p>
        {deal.nextStepType && deal.nextStepDate ? (
          <p className="text-sm text-gray-800">
            Next step:{" "}
            {NEXT_STEP_LABELS[deal.nextStepType as NextStepTypeValue] ?? deal.nextStepType}
            {" · "}
            {deal.nextStepDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
          </p>
        ) : null}
        <Link
          href={`/deals/${deal.id}/log`}
          className="inline-block mt-3 rounded bg-black px-3 py-2 text-white"
        >
          Log Interaction
        </Link>
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Interaction Timeline</h2>
        <div className="space-y-3">
          {deal.logs.map((log) => (
            <div key={log.id} className="border rounded p-3">
              <p className="text-sm">{new Date(log.createdAt).toLocaleString()}</p>
              <p className="text-sm">Type: {log.interactionType}</p>
              <p className="text-sm">Outcome: {log.outcome}</p>
              <p className="text-sm">Stakeholder: {log.stakeholderType}</p>
              <p className="text-sm">
                Risks: {log.risks.map((r) => r.category).join(", ")}
              </p>
              {log.notes ? <p className="text-sm">Notes: {log.notes}</p> : null}
            </div>
          ))}
          {deal.logs.length === 0 ? <p>No interactions logged yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
