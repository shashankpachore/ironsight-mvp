import type { OutcomeValue } from "./domain";
import { formatYmdInIST } from "./ist-time";

export type MomentumStatus = "CRITICAL" | "STALE" | "AT_RISK" | "ON_TRACK";

export type MomentumDealInput = {
  lastActivityAt: Date | string;
  nextStepDate?: Date | string | null;
};

export type MomentumLogInput = {
  createdAt: Date | string;
  outcome: OutcomeValue;
};

export type DealMomentumResult = {
  momentumStatus: MomentumStatus;
  daysSinceLastActivity: number;
  isOverdue: boolean;
};

const DAY_MS = 86_400_000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function getDealMomentum(
  deal: MomentumDealInput,
  logs: MomentumLogInput[],
): DealMomentumResult {
  const now = new Date();

  const latestLog =
    logs.length > 0
      ? [...logs].sort((a, b) => {
          const aMs = toDate(a.createdAt)?.getTime() ?? 0;
          const bMs = toDate(b.createdAt)?.getTime() ?? 0;
          return bMs - aMs;
        })[0]
      : null;

  const lastActivityDate = latestLog
    ? (toDate(latestLog.createdAt) ?? toDate(deal.lastActivityAt) ?? now)
    : (toDate(deal.lastActivityAt) ?? now);

  const daysSinceLastActivity = Math.max(
    0,
    Math.floor((now.getTime() - lastActivityDate.getTime()) / DAY_MS),
  );

  const nextStepDate = toDate(deal.nextStepDate ?? null);
  const isOverdue = Boolean(
    nextStepDate && formatYmdInIST(nextStepDate) < formatYmdInIST(now),
  );

  if (isOverdue || daysSinceLastActivity >= 10) {
    return { momentumStatus: "CRITICAL", daysSinceLastActivity, isOverdue };
  }

  if (daysSinceLastActivity >= 7) {
    return { momentumStatus: "STALE", daysSinceLastActivity, isOverdue };
  }

  const lastOutcome = latestLog?.outcome;
  const atRisk =
    (lastOutcome === "PROPOSAL_SHARED" && daysSinceLastActivity > 2) ||
    (lastOutcome === "DEMO_DONE" && daysSinceLastActivity > 3) ||
    (lastOutcome === "NEGOTIATION_STARTED" && daysSinceLastActivity > 2);

  if (atRisk) {
    return { momentumStatus: "AT_RISK", daysSinceLastActivity, isOverdue };
  }

  return { momentumStatus: "ON_TRACK", daysSinceLastActivity, isOverdue };
}
