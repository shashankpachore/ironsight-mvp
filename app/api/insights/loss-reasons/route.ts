import { DealTerminalStage, Outcome, UserRole, type RiskCategory } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { requireRole } from "@/lib/authz";
import { getDealStageFromOutcomes, stageBeforeLoss } from "@/lib/logic/stage";
import type { OutcomeValue } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

type StageBucket = "ACCESS" | "QUALIFIED" | "EVALUATION" | "COMMITTED";

type LossReasonRow = {
  riskCategory: RiskCategory;
  count: number;
  percentContribution: number;
};

type StageRiskRow = {
  stage: StageBucket;
  riskCategory: RiskCategory;
  count: number;
};

const LOSS_OUTCOMES = new Set<Outcome>([Outcome.LOST_TO_COMPETITOR, Outcome.DEAL_DROPPED]);

function toStageBucket(stage: string): StageBucket | null {
  if (stage === "ACCESS" || stage === "QUALIFIED" || stage === "EVALUATION" || stage === "COMMITTED") {
    return stage;
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authz = requireRole(user, [UserRole.MANAGER, UserRole.ADMIN]);
  if (authz) return authz;
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const accessWhere = await buildDealWhere(user);
  const where = {
    ...accessWhere,
    terminalStage: DealTerminalStage.LOST,
  };

  const deals = await prisma.deal.findMany({
    where,
    select: { id: true },
  });
  const dealIds = deals.map((d) => d.id);

  if (dealIds.length === 0) {
    return NextResponse.json({
      summary: {
        totalLostDeals: 0,
        totalLossRiskTags: 0,
      },
      topLossReasons: [] as LossReasonRow[],
      riskFrequencyByStage: [] as StageRiskRow[],
    });
  }

  const logs = await prisma.interactionLog.findMany({
    where: { dealId: { in: dealIds } },
    select: {
      id: true,
      dealId: true,
      outcome: true,
      createdAt: true,
      risks: { select: { category: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const logsByDeal = new Map<string, typeof logs>();
  for (const log of logs) {
    const arr = logsByDeal.get(log.dealId) ?? [];
    arr.push(log);
    logsByDeal.set(log.dealId, arr);
  }

  const lossCounts = new Map<RiskCategory, number>();
  const stageRiskCounts = new Map<string, number>();
  let totalLossRiskTags = 0;

  for (const dealId of dealIds) {
    const dealLogs = logsByDeal.get(dealId) ?? [];
    const lossIndex = dealLogs.findIndex((log) => LOSS_OUTCOMES.has(log.outcome));
    if (lossIndex < 0) continue;

    const outcomesUntilFirstLoss = dealLogs
      .slice(0, lossIndex + 1)
      .map((log) => log.outcome as OutcomeValue);
    const inferredStageBeforeLoss = stageBeforeLoss(outcomesUntilFirstLoss);
    const cumulativeOutcomes: OutcomeValue[] = [];

    for (let i = 0; i <= lossIndex; i += 1) {
      const log = dealLogs[i];
      const stage = LOSS_OUTCOMES.has(log.outcome)
        ? inferredStageBeforeLoss
        : getDealStageFromOutcomes([...cumulativeOutcomes, log.outcome as OutcomeValue]);
      const stageBucket = toStageBucket(stage);

      for (const risk of log.risks) {
        totalLossRiskTags += 1;
        lossCounts.set(risk.category, (lossCounts.get(risk.category) ?? 0) + 1);
        if (stageBucket) {
          const key = `${stageBucket}::${risk.category}`;
          stageRiskCounts.set(key, (stageRiskCounts.get(key) ?? 0) + 1);
        }
      }
      cumulativeOutcomes.push(log.outcome as OutcomeValue);
    }
  }

  const topLossReasons: LossReasonRow[] = [...lossCounts.entries()]
    .map(([riskCategory, count]) => ({
      riskCategory,
      count,
      percentContribution: totalLossRiskTags === 0 ? 0 : Number(((count / totalLossRiskTags) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.count - a.count || a.riskCategory.localeCompare(b.riskCategory));

  const riskFrequencyByStage: StageRiskRow[] = [...stageRiskCounts.entries()]
    .map(([key, count]) => {
      const [stage, riskCategory] = key.split("::") as [StageBucket, RiskCategory];
      return { stage, riskCategory, count };
    })
    .sort((a, b) => a.stage.localeCompare(b.stage) || b.count - a.count || a.riskCategory.localeCompare(b.riskCategory));

  return NextResponse.json({
    summary: {
      totalLostDeals: dealIds.length,
      totalLossRiskTags,
    },
    topLossReasons,
    riskFrequencyByStage,
  });
}
