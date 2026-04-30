export type IsoWeekRange = {
  week: string;
  startOfWeek: Date;
  endOfWeek: Date;
  nextWeekStart: Date;
};

export type WeekOption = {
  value: string;
  label: string;
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function isoWeekStartForDate(date: Date): Date {
  const utcMidnight = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = utcMidnight.getUTCDay() || 7;
  return new Date(utcMidnight.getTime() - (day - 1) * DAY_MS);
}

function isoWeeksInYear(year: number): number {
  const dec28 = utcDate(year, 11, 28);
  return Number(formatIsoWeek(dec28).slice(5));
}

export function formatIsoWeek(date: Date): string {
  const weekStart = isoWeekStartForDate(date);
  const thursday = new Date(weekStart.getTime() + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstWeekStart = isoWeekStartForDate(utcDate(isoYear, 0, 4));
  const week = Math.floor((weekStart.getTime() - firstWeekStart.getTime()) / WEEK_MS) + 1;
  return `${isoYear}-${String(week).padStart(2, "0")}`;
}

export function rangeForIsoWeek(week: string): IsoWeekRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(week);
  if (!match) return null;

  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(weekNumber)) return null;
  if (weekNumber < 1 || weekNumber > isoWeeksInYear(year)) return null;

  const firstWeekStart = isoWeekStartForDate(utcDate(year, 0, 4));
  const startOfWeek = new Date(firstWeekStart.getTime() + (weekNumber - 1) * WEEK_MS);
  const nextWeekStart = new Date(startOfWeek.getTime() + WEEK_MS);
  const endOfWeek = new Date(nextWeekStart.getTime() - 1);

  return {
    week,
    startOfWeek,
    endOfWeek,
    nextWeekStart,
  };
}

export function currentIsoWeek(now = new Date()): string {
  return formatIsoWeek(now);
}

export function currentIsoWeekRange(now = new Date()): IsoWeekRange {
  const range = rangeForIsoWeek(currentIsoWeek(now));
  if (!range) throw new Error("Unable to compute current ISO week");
  return range;
}

export function previousIsoWeekRange(range: IsoWeekRange): IsoWeekRange {
  const previousWeek = formatIsoWeek(new Date(range.startOfWeek.getTime() - WEEK_MS));
  const previousRange = rangeForIsoWeek(previousWeek);
  if (!previousRange) throw new Error("Unable to compute previous ISO week");
  return previousRange;
}

export function getRecentWeekOptions(count = 12, now = new Date()): WeekOption[] {
  const currentStart = currentIsoWeekRange(now).startOfWeek;
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(currentStart.getTime() - index * WEEK_MS);
    const value = formatIsoWeek(start);
    const end = new Date(start.getTime() + WEEK_MS - 1);
    return {
      value,
      label: `${value} (${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)})`,
    };
  });
}
