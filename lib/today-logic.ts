const DAY_MS = 86_400_000;

export type DealPriority = "CRITICAL" | "ATTENTION" | "UPCOMING" | "IGNORE";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffDaysFloor(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

export function classifyDeal(input: {
  nextStepDate: Date;
  lastActivityAt: Date;
  today?: Date;
}): DealPriority {
  const todayStart = startOfDay(input.today ?? new Date());
  const nextStepStart = startOfDay(input.nextStepDate);
  const lastActivityStart = startOfDay(input.lastActivityAt);

  const daysSinceLastActivity = diffDaysFloor(todayStart, lastActivityStart);
  const upcomingEnd = new Date(todayStart.getTime() + 2 * DAY_MS);
  const criticalCutoff = new Date(todayStart.getTime() - 2 * DAY_MS);

  if (nextStepStart < criticalCutoff || daysSinceLastActivity >= 10) {
    return "CRITICAL";
  }
  if (daysSinceLastActivity >= 7) {
    return "ATTENTION";
  }
  if (nextStepStart >= todayStart && nextStepStart <= upcomingEnd) {
    return "UPCOMING";
  }
  return "IGNORE";
}
