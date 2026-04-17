import type { DealStage } from "./domain";
import type { MomentumStatus } from "./momentum";

type DealLike = {
  value: number;
  nextStepDate?: Date | string | null;
  stage?: DealStage | null;
};

type MomentumLike = {
  momentumStatus: MomentumStatus;
  daysSinceLastActivity: number;
};

type ScoreContext = {
  todayStartUtc: Date;
  upcomingEndUtc: Date;
};

const DAY_MS = 86_400_000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function scoreDeal(
  deal: DealLike,
  momentum: MomentumLike,
  context: ScoreContext,
): { score: number } {
  let score = 0;

  // 1. Momentum
  if (momentum.momentumStatus === "CRITICAL") score += 100;
  else if (momentum.momentumStatus === "AT_RISK") score += 70;
  else if (momentum.momentumStatus === "STALE") score += 40;
  else if (momentum.momentumStatus === "ON_TRACK") score += 10;

  // 2. Urgency (IST boundaries passed in via context)
  const nextStepDate = toDate(deal.nextStepDate);
  if (nextStepDate) {
    const todayStart = context.todayStartUtc.getTime();
    const tomorrowStart = todayStart + DAY_MS;
    const nextMs = nextStepDate.getTime();
    const upcomingEnd = context.upcomingEndUtc.getTime();

    if (nextMs < todayStart) score += 80; // overdue
    else if (nextMs >= todayStart && nextMs < tomorrowStart) score += 50; // due today
    else if (nextMs >= tomorrowStart && nextMs <= upcomingEnd) score += 20; // upcoming (today..+2 window)
  }

  // 3. Stage
  if (deal.stage === "COMMITTED") score += 50;
  else if (deal.stage === "EVALUATION") score += 40;
  else if (deal.stage === "QUALIFIED") score += 25;
  else if (deal.stage === "ACCESS") score += 10;

  // 4. Deal value
  score += Math.min(deal.value / 10_000, 50);

  // 5. Inactivity
  score += Math.min(momentum.daysSinceLastActivity * 2, 30);

  return { score };
}

