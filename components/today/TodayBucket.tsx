"use client";

import Link from "next/link";

export type TodayBucketItem = {
  dealId: string;
  accountName: string;
  nextStepType: string | null;
  nextStepDate: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  daysOverdue: number;
};

function formatDateLabel(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function TodayBucket({
  title,
  items,
}: {
  title: string;
  items: TodayBucketItem[];
}) {
  return (
    <section className="border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-600">No deals in this bucket.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.dealId} className="border rounded p-3 space-y-1">
              <p className="font-medium">{item.accountName}</p>
              <p className="text-sm">Next Step: {item.nextStepType ?? "Unknown"}</p>
              <p className="text-sm">Next Step Date: {formatDateLabel(item.nextStepDate)}</p>
              <p className="text-sm text-gray-700">
                Last activity: {item.daysSinceLastActivity} day{item.daysSinceLastActivity === 1 ? "" : "s"} ago
              </p>
              <Link href={`/deals/${item.dealId}/log`} className="inline-block underline text-sm">
                Log Activity
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

