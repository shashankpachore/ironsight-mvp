import { DealStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { enforceExpiry } from "@/lib/expiry";
import { prisma } from "@/lib/prisma";

const DAY_MS = 1000 * 60 * 60 * 24;

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / DAY_MS);
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const accessWhere = await buildDealWhere(user);
  const activeDeals = await prisma.deal.findMany({
    where: {
      ...accessWhere,
      status: DealStatus.ACTIVE,
    },
    select: { id: true, lastActivityAt: true, status: true },
  });
  await enforceExpiry(activeDeals);

  const where = {
    ...accessWhere,
    status: DealStatus.EXPIRED,
  };
  const deals = await prisma.deal.findMany({
    where,
    select: {
      id: true,
      name: true,
      value: true,
      lastActivityAt: true,
      owner: {
        select: { id: true, name: true },
      },
      coOwner: {
        select: { id: true, name: true },
      },
      account: {
        select: {
          name: true,
          district: true,
          state: true,
        },
      },
    },
    orderBy: { lastActivityAt: "asc" },
  });

  return NextResponse.json(
    deals.map((deal) => ({
      id: deal.id,
      name: deal.name,
      value: deal.value,
      owner: deal.owner,
      coOwner: deal.coOwner,
      account: deal.account,
      lastActivityAt: deal.lastActivityAt,
      daysSinceLastActivity: daysSince(deal.lastActivityAt),
    })),
  );
}
