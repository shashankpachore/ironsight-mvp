import Link from "next/link";
import { formatInr } from "@/lib/currency";
import { getDealStage, getMissingSignals } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      account: true,
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

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <Link href="/" className="text-sm underline">
        Back to deals
      </Link>
      <section className="border rounded-lg p-4 space-y-1">
        <h1 className="text-2xl font-semibold">{deal.account.name}</h1>
        <p className="text-sm text-gray-700">Product: {deal.name}</p>
        <p>Deal Value: {formatInr(deal.value)}</p>
        <p>Stage: {stage}</p>
        <p>Last activity: {deal.lastActivityAt.toLocaleString()}</p>
        <p>
          Missing signals:{" "}
          {missingSignals.length ? missingSignals.join(", ") : "None"}
        </p>
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
