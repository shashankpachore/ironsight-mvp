import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAccessibleUserIds } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { OUTCOME_LABELS, OUTCOMES, type OutcomeValue } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { currentIsoWeekRange, previousIsoWeekRange, rangeForIsoWeek, type IsoWeekRange } from "@/lib/reports/week";

type BreakdownCell = {
  value: number;
  delta: number | null;
};

type WeeklyReportRow = {
  userId: string;
  userName: string;
  totalInteractions: number;
  totalDelta: number | null;
  breakdown: Record<OutcomeValue, BreakdownCell>;
};

function emptyBreakdown(): Record<OutcomeValue, number> {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<OutcomeValue, number>;
}

function emptyBreakdownCells(): Record<OutcomeValue, BreakdownCell> {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, { value: 0, delta: null }])) as Record<
    OutcomeValue,
    BreakdownCell
  >;
}

type AggregateRow = {
  userId: string;
  userName: string;
  totalInteractions: number;
  breakdown: Record<OutcomeValue, number>;
};

async function aggregateWeek(range: IsoWeekRange, ownerIds: string[] | null): Promise<Map<string, AggregateRow>> {
  const logs = await prisma.interactionLog.findMany({
    where: {
      createdAt: {
        gte: range.startOfWeek,
        lt: range.nextWeekStart,
      },
      ...(ownerIds ? { deal: { ownerId: { in: ownerIds } } } : {}),
    },
    select: {
      outcome: true,
      deal: {
        select: {
          owner: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const rowsByUserId = new Map<string, AggregateRow>();
  for (const log of logs) {
    const owner = log.deal.owner;
    const existing =
      rowsByUserId.get(owner.id) ??
      ({
        userId: owner.id,
        userName: owner.name,
        totalInteractions: 0,
        breakdown: emptyBreakdown(),
      } satisfies AggregateRow);

    existing.totalInteractions += 1;
    existing.breakdown[log.outcome] += 1;
    rowsByUserId.set(owner.id, existing);
  }

  return rowsByUserId;
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const range = weekParam ? rangeForIsoWeek(weekParam) : currentIsoWeekRange();
  if (!range) return NextResponse.json({ error: "week must use YYYY-WW ISO format" }, { status: 400 });

  const accessibleUserIds = await getAccessibleUserIds(user);
  const ownerIds =
    user.role === UserRole.MANAGER
      ? (accessibleUserIds ?? []).filter((id) => id !== user.id)
      : accessibleUserIds;

  if (ownerIds && ownerIds.length === 0) {
    const previousRange = previousIsoWeekRange(range);
    return NextResponse.json({
      week: range.week,
      startOfWeek: range.startOfWeek.toISOString(),
      endOfWeek: range.endOfWeek.toISOString(),
      previousWeek: previousRange.week,
      previousStartOfWeek: previousRange.startOfWeek.toISOString(),
      previousEndOfWeek: previousRange.endOfWeek.toISOString(),
      outcomes: OUTCOMES.map((value) => ({ value, label: OUTCOME_LABELS[value] })),
      rows: [] satisfies WeeklyReportRow[],
    });
  }

  const previousRange = previousIsoWeekRange(range);
  const [currentRowsByUserId, previousRowsByUserId] = await Promise.all([
    aggregateWeek(range, ownerIds),
    aggregateWeek(previousRange, ownerIds),
  ]);

  const rows = [...currentRowsByUserId.values()].map((currentRow) => {
    const previousRow = previousRowsByUserId.get(currentRow.userId);
    const breakdown = emptyBreakdownCells();

    for (const outcome of OUTCOMES) {
      const value = currentRow.breakdown[outcome];
      breakdown[outcome] = {
        value,
        delta: previousRow ? value - previousRow.breakdown[outcome] : null,
      };
    }

    return {
      userId: currentRow.userId,
      userName: currentRow.userName,
      totalInteractions: currentRow.totalInteractions,
      totalDelta: previousRow ? currentRow.totalInteractions - previousRow.totalInteractions : null,
      breakdown,
    } satisfies WeeklyReportRow;
  }).sort(
    (a, b) => b.totalInteractions - a.totalInteractions || a.userName.localeCompare(b.userName),
  );

  return NextResponse.json({
    week: range.week,
    startOfWeek: range.startOfWeek.toISOString(),
    endOfWeek: range.endOfWeek.toISOString(),
    previousWeek: previousRange.week,
    previousStartOfWeek: previousRange.startOfWeek.toISOString(),
    previousEndOfWeek: previousRange.endOfWeek.toISOString(),
    outcomes: OUTCOMES.map((value) => ({ value, label: OUTCOME_LABELS[value] })),
    rows,
  });
}
