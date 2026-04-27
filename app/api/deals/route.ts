import { AuditAction, AuditEntityType, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { validateDealCreationAccess } from "@/lib/account-access";
import { buildDealWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getDealStage, getMissingSignals } from "@/lib/deals";
import { compareDealsByDisplayOrder } from "@/lib/deal-order";
import { addDaysYmd, formatYmdInIST, istYmdToUtcStart } from "@/lib/ist-time";
import { getDealMomentum } from "@/lib/momentum";
import { prisma } from "@/lib/prisma";
import { scoreDeal } from "@/lib/ranking";
import { validateDealInput } from "@/lib/validation";

const DEAL_STAGES = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED", "CLOSED", "LOST"] as const;

type DealWithListRelations = Prisma.DealGetPayload<{
  include: {
    owner: {
      select: { id: true; name: true };
    };
    account: {
      select: {
        id: true;
        name: true;
        district: true;
        state: true;
        assignedToId: true;
        assignedTo: {
          select: { id: true; name: true; managerId: true };
        };
      };
    };
  };
}>;

export async function POST(request: Request) {
  const body = await request.json();
  const error = validateDealInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const owner = await getCurrentUser(request);
  if (!owner) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { id: body.accountId },
  });
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  const accessError = validateDealCreationAccess({
    account: { status: account.status, assignedToId: account.assignedToId },
    currentUserId: owner.id,
  });
  if (accessError) {
    const status = accessError === "only assigned user can create deal" ? 403 : 400;
    return NextResponse.json({ error: accessError }, { status });
  }
  if (!account.assignedToId) {
    return NextResponse.json({ error: "account must be assigned before creating deals" }, { status: 400 });
  }

  const deal = await prisma.deal.create({
    data: {
      name: body.name,
      companyName: account.name,
      value: body.value,
      ownerId: account.assignedToId,
      accountId: account.id,
    },
  });

  await logAudit({
    entityType: AuditEntityType.DEAL,
    entityId: deal.id,
    action: AuditAction.CREATE,
    changedById: owner.id,
    before: null,
    after: deal,
  });

  return NextResponse.json(deal, { status: 201 });
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });
  const url = new URL(request.url);
  const stage = url.searchParams.get("stage");
  const stages = url.searchParams.get("stages");
  const ownerId = url.searchParams.get("ownerId");
  const managerId = url.searchParams.get("managerId");
  const unassignedOnly = url.searchParams.get("unassigned") === "1";
  const stageFilters = new Set<string>();
  if (stage) stageFilters.add(stage);
  if (stages) {
    const requestedStages = stages.split(",").map((value) => value.trim()).filter(Boolean);
    if (requestedStages.length === 0) {
      return NextResponse.json({ error: "invalid stage filter" }, { status: 400 });
    }
    requestedStages.forEach((value) => stageFilters.add(value));
  }
  if (
    Array.from(stageFilters).some(
      (value) => !DEAL_STAGES.includes(value as (typeof DEAL_STAGES)[number]),
    )
  ) {
    return NextResponse.json({ error: "invalid stage filter" }, { status: 400 });
  }

  const now = new Date();
  const todayYmd = formatYmdInIST(now);
  const todayStartUtc = istYmdToUtcStart(todayYmd);
  const upcomingEndUtc = istYmdToUtcStart(addDaysYmd(todayYmd, 2));

  const where = await buildDealWhere(user);

  let deals: DealWithListRelations[];
  try {
    deals = await prisma.deal.findMany({
      where,
      include: {
        owner: {
          select: { id: true, name: true },
        },
        account: {
          select: {
            id: true,
            name: true,
            district: true,
            state: true,
            assignedToId: true,
            assignedTo: {
              select: { id: true, name: true, managerId: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("Failed to load deals", err);
    return NextResponse.json({ error: "failed to load deals" }, { status: 500 });
  }
  const dealIds = deals.map((deal) => deal.id);
  const logs = await prisma.interactionLog.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, createdAt: true, outcome: true },
  });
  const logsByDealId = new Map<string, Array<{ createdAt: Date; outcome: typeof logs[number]["outcome"] }>>();
  for (const log of logs) {
    const arr = logsByDealId.get(log.dealId) ?? [];
    arr.push({ createdAt: log.createdAt, outcome: log.outcome });
    logsByDealId.set(log.dealId, arr);
  }

  const enriched = await Promise.all(
    deals.map(async (deal) => {
      const stage = await getDealStage(deal.id);
      const missingSignals = await getMissingSignals(deal.id);
      const momentum = getDealMomentum(
        { lastActivityAt: deal.lastActivityAt, nextStepDate: deal.nextStepDate },
        logsByDealId.get(deal.id) ?? [],
      );
      const priorityScore = scoreDeal(
        { value: deal.value, nextStepDate: deal.nextStepDate, stage },
        momentum,
        { todayStartUtc, upcomingEndUtc },
      ).score;
      return {
        ...deal,
        stage,
        missingSignals,
        momentumStatus: momentum.momentumStatus,
        priorityScore,
      };
    }),
  );

  const sorted = [...enriched].sort(
    (a, b) => b.priorityScore - a.priorityScore || compareDealsByDisplayOrder(a, b),
  );
  const filtered = sorted.filter((deal) => {
    if (stageFilters.size > 0 && !stageFilters.has(deal.stage)) return false;
    if (ownerId && deal.ownerId !== ownerId) return false;
    if (managerId) {
      const assignedUser = deal.account.assignedTo;
      const inManagerScope = assignedUser?.id === managerId || assignedUser?.managerId === managerId;
      if (!inManagerScope) return false;
    }
    if (unassignedOnly && deal.account.assignedToId) return false;
    return true;
  });
  return NextResponse.json(filtered);
}
