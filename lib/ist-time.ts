/** India Standard Time: fixed +05:30, no DST. */

const IST_OFFSET = "+05:30";

export function formatYmdInIST(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

/** `ymd` is `YYYY-MM-DD` in the IST calendar. */
export function istYmdToUtcStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000${IST_OFFSET}`);
}

export function istYmdToUtcEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999${IST_OFFSET}`);
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const start = istYmdToUtcStart(ymd);
  const next = new Date(start.getTime() + deltaDays * 86_400_000);
  return formatYmdInIST(next);
}

export type ComplianceWindows = {
  todayYmd: string;
  yesterdayYmd: string;
  yesterdayStartUtc: Date;
  yesterdayEndUtc: Date;
  weekStartYmd: string;
  weekStartUtc: Date;
  todayEndUtc: Date;
};

/** Last 7 days including today in IST: [today-6, today] inclusive. */
export function getComplianceWindows(now: Date): ComplianceWindows {
  const todayYmd = formatYmdInIST(now);
  const yesterdayYmd = addDaysYmd(todayYmd, -1);
  const weekStartYmd = addDaysYmd(todayYmd, -6);
  return {
    todayYmd,
    yesterdayYmd,
    yesterdayStartUtc: istYmdToUtcStart(yesterdayYmd),
    yesterdayEndUtc: istYmdToUtcEnd(yesterdayYmd),
    weekStartYmd,
    weekStartUtc: istYmdToUtcStart(weekStartYmd),
    todayEndUtc: istYmdToUtcEnd(todayYmd),
  };
}
