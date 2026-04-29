"use client";

import { useRouter } from "next/navigation";
import { useExpiredDeals } from "@/hooks/useExpiredDeals";
import { formatInr } from "@/lib/currency";

function inactivityClass(days: number): string {
  if (days > 60) return "text-red-600 font-medium";
  return "text-orange-600 font-medium";
}

export default function ExpiredDealsPage() {
  const router = useRouter();
  const expiredDealsQuery = useExpiredDeals();
  const deals = expiredDealsQuery.data ?? [];
  const loading = expiredDealsQuery.isLoading;
  const error = expiredDealsQuery.error;

  function openDealLog(dealId: string) {
    router.push(`/deals/${dealId}/log`);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Expired Deals</h1>
        <p className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
          Deals move here automatically after 45 days of inactivity. Log a new interaction to reactivate them.
        </p>
      </div>

      {loading ? <p>Loading expired deals...</p> : null}
      {error ? <p className="text-sm text-red-600">Failed to load expired deals.</p> : null}

      {!loading && !error ? (
        deals.length === 0 ? (
          <section className="border rounded-lg p-4">
            <p className="text-sm text-gray-600">No expired deals. Good pipeline hygiene.</p>
          </section>
        ) : (
          <section className="overflow-x-auto border rounded-lg">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border-b p-3 text-left">S.No</th>
                  <th className="border-b p-3 text-left">Deal Name</th>
                  <th className="border-b p-3 text-left">Account Name</th>
                  <th className="border-b p-3 text-left">Owner Name</th>
                  <th className="border-b p-3 text-left">Value</th>
                  <th className="border-b p-3 text-left">Last Activity Date</th>
                  <th className="border-b p-3 text-left">Days Since Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal, index) => (
                  <tr
                    key={deal.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                    onClick={() => openDealLog(deal.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDealLog(deal.id);
                      }
                    }}
                  >
                    <td className="border-b p-3">{index + 1}</td>
                    <td className="border-b p-3 font-medium">{deal.name}</td>
                    <td className="border-b p-3">{deal.account.name}</td>
                    <td className="border-b p-3">{deal.owner.name}</td>
                    <td className="border-b p-3">{formatInr(deal.value)}</td>
                    <td className="border-b p-3">{new Date(deal.lastActivityAt).toLocaleString()}</td>
                    <td className={`border-b p-3 ${inactivityClass(deal.daysSinceLastActivity)}`}>
                      {deal.daysSinceLastActivity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      ) : null}
    </main>
  );
}
