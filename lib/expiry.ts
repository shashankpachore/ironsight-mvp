import { DealStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const EXPIRY_DAYS = 45;
const DAY_MS = 1000 * 60 * 60 * 24;

type ExpirableDeal = {
  id: string;
  lastActivityAt: Date;
  status: DealStatus;
};

export function isDealExpired(lastActivityAt: Date): boolean {
  const diffDays = (Date.now() - lastActivityAt.getTime()) / DAY_MS;
  return diffDays >= EXPIRY_DAYS;
}

export function getExpiryWarning(daysSinceLastActivity: number) {
  if (daysSinceLastActivity >= EXPIRY_DAYS) return "EXPIRED";
  if (daysSinceLastActivity >= 30) return "EXPIRING_SOON";
  return null;
}

export async function enforceExpiry<T extends ExpirableDeal>(deals: T[]): Promise<T[]> {
  const expiredDeals = deals.filter(
    (deal) => deal.status !== DealStatus.EXPIRED && isDealExpired(deal.lastActivityAt),
  );

  if (expiredDeals.length > 0) {
    await prisma.deal.updateMany({
      where: {
        id: { in: expiredDeals.map((deal) => deal.id) },
        status: { not: DealStatus.EXPIRED },
      },
      data: { status: DealStatus.EXPIRED },
    });
  }

  return deals.map((deal) =>
    isDealExpired(deal.lastActivityAt) && deal.status !== DealStatus.EXPIRED
      ? { ...deal, status: DealStatus.EXPIRED }
      : deal,
  );
}

export function getActiveDeals<T extends ExpirableDeal>(deals: T[]): T[] {
  return deals.filter(
    (deal) => deal.status === DealStatus.ACTIVE && !isDealExpired(deal.lastActivityAt),
  );
}
