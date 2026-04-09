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
};

const STAGE_RANK = new Map<string, number>(
  DEAL_STAGE_DISPLAY_ORDER.map((stage, index) => [stage, index]),
);

function toTimestamp(value: string | Date) {
  return new Date(value).getTime();
}

export function compareDealsByDisplayOrder(a: DealLike, b: DealLike) {
  const stageRankA = STAGE_RANK.get(a.stage) ?? Number.MAX_SAFE_INTEGER;
  const stageRankB = STAGE_RANK.get(b.stage) ?? Number.MAX_SAFE_INTEGER;
  if (stageRankA !== stageRankB) return stageRankA - stageRankB;
  if (a.value !== b.value) return b.value - a.value;
  return toTimestamp(b.lastActivityAt) - toTimestamp(a.lastActivityAt);
}

export function sortDealsByDisplayOrder<T extends DealLike>(deals: T[]) {
  return [...deals].sort(compareDealsByDisplayOrder);
}
