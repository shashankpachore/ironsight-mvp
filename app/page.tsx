import { cookies, headers } from "next/headers";
import { CreateDealForm } from "@/components/create-deal-form";
import { DealsListSearch } from "@/components/deals-list-search";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
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
        <DealsListSearch activeDeals={activeDeals} closedDeals={closedDeals} />
      </section>
    </main>
  );
}
