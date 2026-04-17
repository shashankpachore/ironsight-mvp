"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatInr } from "@/lib/currency";

type DealItem = {
  id: string;
  name: string;
  value: number;
  stage: string;
  lastActivityAt: string;
  missingSignals: string[];
  account: { name: string };
  lastActivityAtLabel: string;
};

export function DealsListSearch({
  activeDeals,
  closedDeals,
}: {
  activeDeals: DealItem[];
  closedDeals: DealItem[];
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const query = searchQuery.trim().toLowerCase();
  const canFilter = query.length >= 2;

  const filteredActiveDeals = useMemo(() => {
    if (!canFilter) return activeDeals;
    return activeDeals.filter(
      (deal) =>
        deal.account.name.toLowerCase().includes(query) ||
        deal.name.toLowerCase().includes(query),
    );
  }, [activeDeals, canFilter, query]);

  const filteredClosedDeals = useMemo(() => {
    if (!canFilter) return closedDeals;
    return closedDeals.filter(
      (deal) =>
        deal.account.name.toLowerCase().includes(query) ||
        deal.name.toLowerCase().includes(query),
    );
  }, [closedDeals, canFilter, query]);

  const noMatches =
    canFilter && filteredActiveDeals.length === 0 && filteredClosedDeals.length === 0;

  return (
    <div className="space-y-3">
      <input
        type="text"
        className="w-full border rounded px-3 py-2 text-sm"
        placeholder="Search by school name"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      {noMatches ? <p className="text-sm text-gray-700">No deals found</p> : null}

      {filteredActiveDeals.map((deal) => (
        <Link
          href={`/deals/${deal.id}`}
          key={deal.id}
          className="block border rounded p-3 hover:bg-gray-50"
        >
          <p className="text-lg font-semibold">{deal.account.name}</p>
          <p className="text-sm text-gray-700">Product: {deal.name}</p>
          <p className="text-sm">Deal Value: {formatInr(deal.value)}</p>
          <p className="text-sm">Stage: {deal.stage}</p>
          <p className="text-sm">Last activity: {deal.lastActivityAtLabel}</p>
          <p className="text-sm">
            Missing: {deal.missingSignals.length ? deal.missingSignals.join(", ") : "None"}
          </p>
        </Link>
      ))}

      {filteredActiveDeals.length > 0 && filteredClosedDeals.length > 0 ? (
        <div className="pt-2 border-t">
          <p className="text-sm font-medium text-gray-700">Closed Deals</p>
        </div>
      ) : null}

      {filteredClosedDeals.map((deal) => (
        <Link
          href={`/deals/${deal.id}`}
          key={deal.id}
          className="block border rounded p-3 hover:bg-gray-50"
        >
          <p className="text-lg font-semibold">{deal.account.name}</p>
          <p className="text-sm text-gray-700">Product: {deal.name}</p>
          <p className="text-sm">Deal Value: {formatInr(deal.value)}</p>
          <p className="text-sm">Stage: {deal.stage}</p>
          <p className="text-sm">Last activity: {deal.lastActivityAtLabel}</p>
          <p className="text-sm">
            Missing: {deal.missingSignals.length ? deal.missingSignals.join(", ") : "None"}
          </p>
        </Link>
      ))}

      {!canFilter && activeDeals.length + closedDeals.length === 0 ? <p>No deals yet.</p> : null}
    </div>
  );
}

