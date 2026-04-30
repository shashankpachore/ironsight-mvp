import { DealStatus, UserRole, type PrismaClient } from "@prisma/client";
import { getAccessibleUserIds } from "@/lib/access";
import { getDealStageFromLogs } from "@/lib/deals";
import type { DealStage } from "@/lib/domain";
import { enforceExpiry, getActiveDeals } from "@/lib/expiry";
import { prisma } from "@/lib/prisma";

export const PIPELINE_STAGE_KEYS = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED"] as const;
export const TERMINAL_STAGE_KEYS = ["CLOSED", "LOST"] as const;
export const SNAPSHOT_STAGE_KEYS = [...PIPELINE_STAGE_KEYS, ...TERMINAL_STAGE_KEYS] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGE_KEYS)[number];
export type TerminalStageKey = (typeof TERMINAL_STAGE_KEYS)[number];
export type SnapshotStageKey = (typeof SNAPSHOT_STAGE_KEYS)[number];
export type StageSummary = { count: number; value: number };
export type PipelineShape = Record<PipelineStageKey, StageSummary>;
export type TerminalOutcomesShape = Record<TerminalStageKey, StageSummary>;
export type SnapshotStageBreakdown = Record<SnapshotStageKey, StageSummary>;

type SnapshotPrismaClient = Pick<
  PrismaClient,
  "deal" | "interactionLog" | "pipelineSnapshot" | "$transaction" | "user"
>;

type AccessUser = {
  id: string;
  role: UserRole;
};

export type MonthlyPipelineOwnerRow = {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  stageBreakdown: SnapshotStageBreakdown;
  stages: PipelineShape;
  outcomes: TerminalOutcomesShape;
  totalPipeline: number;
};

export type MonthlyPipelineSnapshotResponse = {
  month: string;
  source: "snapshot";
  totalPipeline: number;
  stageBreakdown: SnapshotStageBreakdown;
  totals: PipelineShape;
  pipeline: PipelineShape;
  outcomes: TerminalOutcomesShape;
  perRepBreakdown: MonthlyPipelineOwnerRow[];
};

export class MonthlySnapshotConflictError extends Error {
  constructor(month: string) {
    super(`Pipeline snapshot already exists for ${month}`);
    this.name = "MonthlySnapshotConflictError";
  }
}

export function isValidSnapshotMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function currentSnapshotMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isCurrentSnapshotMonth(month: string, now = new Date()): boolean {
  return month === currentSnapshotMonth(now);
}

export function emptyPipeline(): PipelineShape {
  return {
    ACCESS: { count: 0, value: 0 },
    QUALIFIED: { count: 0, value: 0 },
    EVALUATION: { count: 0, value: 0 },
    COMMITTED: { count: 0, value: 0 },
  };
}

export function emptyTerminalOutcomes(): TerminalOutcomesShape {
  return {
    CLOSED: { count: 0, value: 0 },
    LOST: { count: 0, value: 0 },
  };
}

export function emptySnapshotStageBreakdown(): SnapshotStageBreakdown {
  return {
    ACCESS: { count: 0, value: 0 },
    QUALIFIED: { count: 0, value: 0 },
    EVALUATION: { count: 0, value: 0 },
    COMMITTED: { count: 0, value: 0 },
    CLOSED: { count: 0, value: 0 },
    LOST: { count: 0, value: 0 },
  };
}

export function splitStageBreakdown(stageBreakdown: SnapshotStageBreakdown) {
  const stages = emptyPipeline();
  const outcomes = emptyTerminalOutcomes();
  for (const stage of PIPELINE_STAGE_KEYS) stages[stage] = { ...stageBreakdown[stage] };
  for (const stage of TERMINAL_STAGE_KEYS) outcomes[stage] = { ...stageBreakdown[stage] };
  return { stages, outcomes };
}

function accumulate(stageBreakdown: SnapshotStageBreakdown, stage: DealStage, value: number) {
  stageBreakdown[stage].count += 1;
  stageBreakdown[stage].value += value;
}

function pipelineValue(stages: PipelineShape) {
  return PIPELINE_STAGE_KEYS.reduce((sum, stage) => sum + stages[stage].value, 0);
}

export async function generateMonthlySnapshot(month: string, client: SnapshotPrismaClient = prisma) {
  if (!isValidSnapshotMonth(month)) {
    throw new Error("month must use YYYY-MM format");
  }

  const existing = await client.pipelineSnapshot.findFirst({
    where: { month },
    select: { id: true },
  });
  if (existing) {
    throw new MonthlySnapshotConflictError(month);
  }

  const deals = await client.deal.findMany({
    where: { status: DealStatus.ACTIVE },
    select: {
      id: true,
      ownerId: true,
      value: true,
      status: true,
      lastActivityAt: true,
    },
  });
  const activeDeals = getActiveDeals(await enforceExpiry(deals));
  const logs = activeDeals.length
    ? await client.interactionLog.findMany({
        where: { dealId: { in: activeDeals.map((deal) => deal.id) } },
        select: { dealId: true, outcome: true },
      })
    : [];
  const logsByDealId = new Map<string, Array<{ outcome: typeof logs[number]["outcome"] }>>();
  for (const log of logs) {
    const dealLogs = logsByDealId.get(log.dealId) ?? [];
    dealLogs.push({ outcome: log.outcome });
    logsByDealId.set(log.dealId, dealLogs);
  }

  const grouped = new Map<string, { ownerId: string; stage: DealStage; totalValue: number; dealCount: number }>();
  for (const deal of activeDeals) {
    const stage = getDealStageFromLogs(logsByDealId.get(deal.id) ?? []);
    const key = `${deal.ownerId}:${stage}`;
    const row = grouped.get(key) ?? {
      ownerId: deal.ownerId,
      stage,
      totalValue: 0,
      dealCount: 0,
    };
    row.totalValue += deal.value;
    row.dealCount += 1;
    grouped.set(key, row);
  }

  const rows = [...grouped.values()].map((row) => ({
    month,
    ownerId: row.ownerId,
    stage: row.stage,
    totalValue: row.totalValue,
    dealCount: row.dealCount,
  }));

  if (rows.length === 0) {
    return { month, insertedCount: 0 };
  }

  await client.$transaction(
    rows.map((row) =>
      client.pipelineSnapshot.create({
        data: row,
      }),
    ),
  );

  return { month, insertedCount: rows.length };
}

export async function ownerIdsForMonthlyPipeline(user: AccessUser) {
  const accessibleUserIds = await getAccessibleUserIds(user);
  if (user.role === UserRole.MANAGER) {
    return (accessibleUserIds ?? []).filter((id) => id !== user.id);
  }
  return accessibleUserIds;
}

export async function getMonthlyPipelineSnapshot(
  month: string,
  user: AccessUser,
  client: SnapshotPrismaClient = prisma,
): Promise<MonthlyPipelineSnapshotResponse> {
  if (!isValidSnapshotMonth(month)) {
    throw new Error("month must use YYYY-MM format");
  }

  const ownerIds = await ownerIdsForMonthlyPipeline(user);
  const rows = ownerIds && ownerIds.length === 0
    ? []
    : await client.pipelineSnapshot.findMany({
        where: {
          month,
          ...(ownerIds ? { ownerId: { in: ownerIds } } : {}),
        },
        select: {
          ownerId: true,
          stage: true,
          totalValue: true,
          dealCount: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ owner: { name: "asc" } }, { stage: "asc" }],
      });

  const totalBreakdown = emptySnapshotStageBreakdown();
  const rowsByOwner = new Map<string, MonthlyPipelineOwnerRow>();
  for (const row of rows) {
    if (!SNAPSHOT_STAGE_KEYS.includes(row.stage as SnapshotStageKey)) continue;
    const stage = row.stage as SnapshotStageKey;
    totalBreakdown[stage].count += row.dealCount;
    totalBreakdown[stage].value += row.totalValue;

    const ownerRow =
      rowsByOwner.get(row.ownerId) ??
      ({
        ownerId: row.owner.id,
        ownerName: row.owner.name,
        ownerEmail: row.owner.email,
        stageBreakdown: emptySnapshotStageBreakdown(),
        stages: emptyPipeline(),
        outcomes: emptyTerminalOutcomes(),
        totalPipeline: 0,
      } satisfies MonthlyPipelineOwnerRow);
    ownerRow.stageBreakdown[stage].count += row.dealCount;
    ownerRow.stageBreakdown[stage].value += row.totalValue;
    rowsByOwner.set(row.ownerId, ownerRow);
  }

  const { stages: totals, outcomes } = splitStageBreakdown(totalBreakdown);
  const perRepBreakdown = [...rowsByOwner.values()].map((row) => {
    const { stages, outcomes: ownerOutcomes } = splitStageBreakdown(row.stageBreakdown);
    return {
      ...row,
      stages,
      outcomes: ownerOutcomes,
      totalPipeline: pipelineValue(stages),
    };
  });

  return {
    month,
    source: "snapshot",
    totalPipeline: pipelineValue(totals),
    stageBreakdown: totalBreakdown,
    totals,
    pipeline: totals,
    outcomes,
    perRepBreakdown,
  };
}
