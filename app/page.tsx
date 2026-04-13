import Link from "next/link";
import { cookies, headers } from "next/headers";
import { CreateDealForm } from "@/components/create-deal-form";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { formatInr } from "@/lib/currency";
import { sortDealsByDisplayOrder } from "@/lib/deal-order";
import { prisma } from "@/lib/prisma";

type DealItem = {
  id: string;
  name: string;
  value: number;
  stage: string;
  lastActivityAt: string;
  missingSignals: string[];
  account: { name: string };
};

export default async function Home() {
  const cookieStore = await cookies();
  const sessionUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionUser = sessionUserId
    ? await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { role: true },
    })
    : null;
  void sessionUser;

  const incomingHeaders = await headers();
  const host = incomingHeaders.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const cookieHeader = incomingHeaders.get("cookie");

  const forwardHeaders: Record<string, string> = {};
  if (cookieHeader) forwardHeaders.cookie = cookieHeader;

  let deals: DealItem[] = [];
  let loadError = "";
  if (host) {
    const dealsRes = await fetch(`${protocol}://${host}/api/deals`, {
      headers: forwardHeaders,
      cache: "no-store",
    });
    if (dealsRes.ok) {
      deals = (await dealsRes.json()) as DealItem[];
    } else {
      loadError = "Could not load deals for current user.";
    }
  } else {
    loadError = "Could not resolve server host for deals.";
  }

  const enriched = deals.map((deal) => ({
    ...deal,
    lastActivityAtLabel: new Date(deal.lastActivityAt).toLocaleString(),
  }));
  const sortedDeals = sortDealsByDisplayOrder(enriched);
  const activeDeals = sortedDeals.filter((deal) => deal.stage !== "CLOSED");
  const closedDeals = sortedDeals.filter((deal) => deal.stage === "CLOSED");

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Ironsight - Deal Tracker</h1>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Create Deal</h2>
        <CreateDealForm />
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-3">Deals</h2>
        {loadError ? <p className="text-sm text-red-600 mb-2">{loadError}</p> : null}
        <div className="space-y-3">
          {activeDeals.map((deal) => (
            <Link
              href={`/deals/${deal.id}`}
              key={deal.id}
              className="block border rounded p-3 hover:bg-gray-50"
            >
              <p className="text-lg font-semibold">{deal.account.name}</p>
              <p className="text-sm text-gray-700">Product: {deal.name}</p>
              <p className="text-sm">Deal Value: {formatInr(deal.value)}</p>
              <p className="text-sm">Stage: {deal.stage}</p>
              <p className="text-sm">
                Last activity: {deal.lastActivityAtLabel}
              </p>
              <p className="text-sm">
                Missing:{" "}
                {deal.missingSignals.length
                  ? deal.missingSignals.join(", ")
                  : "None"}
              </p>
            </Link>
          ))}
          {activeDeals.length > 0 && closedDeals.length > 0 ? (
            <div className="pt-2 border-t">
              <p className="text-sm font-medium text-gray-700">Closed Deals</p>
            </div>
          ) : null}
          {closedDeals.map((deal) => (
            <Link
              href={`/deals/${deal.id}`}
              key={deal.id}
              className="block border rounded p-3 hover:bg-gray-50"
            >
              <p className="text-lg font-semibold">{deal.account.name}</p>
              <p className="text-sm text-gray-700">Product: {deal.name}</p>
              <p className="text-sm">Deal Value: {formatInr(deal.value)}</p>
              <p className="text-sm">Stage: {deal.stage}</p>
              <p className="text-sm">
                Last activity: {deal.lastActivityAtLabel}
              </p>
              <p className="text-sm">
                Missing:{" "}
                {deal.missingSignals.length
                  ? deal.missingSignals.join(", ")
                  : "None"}
              </p>
            </Link>
          ))}
          {sortedDeals.length === 0 ? <p>No deals yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
