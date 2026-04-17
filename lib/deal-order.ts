export const DEAL_STAGE_DISPLAY_ORDER = [
  "COMMITTED",
  "EVALUATION",
  "QUALIFIED",
  "ACCESS",
  "CLOSED",
] as const;

type DealLike = {
  stage: string;
  value: number;
  lastActivityAt: string | Date;
  momentumStatus?: "CRITICAL" | "AT_RISK" | "STALE" | "ON_TRACK";
};

const STAGE_RANK = new Map<string, number>(
  DEAL_STAGE_DISPLAY_ORDER.map((stage, index) => [stage, index]),
);
const MOMENTUM_RANK = new Map<string, number>([
  ["CRITICAL", 0],
  ["AT_RISK", 1],
  ["STALE", 2],
  ["ON_TRACK", 3],
]);

function toTimestamp(value: string | Date) {
  return new Date(value).getTime();
}

export function compareDealsByDisplayOrder(a: DealLike, b: DealLike) {
  const momentumRankA = MOMENTUM_RANK.get(a.momentumStatus ?? "") ?? Number.MAX_SAFE_INTEGER;
  const momentumRankB = MOMENTUM_RANK.get(b.momentumStatus ?? "") ?? Number.MAX_SAFE_INTEGER;
  if (momentumRankA !== momentumRankB) return momentumRankA - momentumRankB;
  const stageRankA = STAGE_RANK.get(a.stage) ?? Number.MAX_SAFE_INTEGER;
  const stageRankB = STAGE_RANK.get(b.stage) ?? Number.MAX_SAFE_INTEGER;
  if (stageRankA !== stageRankB) return stageRankA - stageRankB;
  if (a.value !== b.value) return b.value - a.value;
  return toTimestamp(b.lastActivityAt) - toTimestamp(a.lastActivityAt);
}

export function sortDealsByDisplayOrder<T extends DealLike>(deals: T[]) {
  return [...deals].sort(compareDealsByDisplayOrder);
}
