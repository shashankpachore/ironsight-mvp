import { AuditAction, AuditEntityType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { validateDealCreationAccess } from "@/lib/account-access";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sortDealsByDisplayOrder } from "@/lib/deal-order";
import { getDealStage, getMissingSignals } from "@/lib/deals";
import { prisma } from "@/lib/prisma";
import { validateDealInput } from "@/lib/validation";

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

  const deal = await prisma.deal.create({
    data: {
      name: body.name,
      companyName: account.name,
      value: body.value,
      ownerId: owner.id,
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

  let where = {};
  if (user.role === UserRole.REP) {
    where = { account: { assignedToId: user.id } };
  } else if (user.role === UserRole.MANAGER) {
    const reports = await prisma.user.findMany({
      where: { managerId: user.id, role: UserRole.REP },
      select: { id: true },
    });
    const assigneeIds = [user.id, ...reports.map((report) => report.id)];
    where = { account: { assignedToId: { in: assigneeIds } } };
  }

  const deals = await prisma.deal.findMany({
    where,
    include: { account: true },
    orderBy: { createdAt: "desc" },
  });

  const enriched = await Promise.all(
    deals.map(async (deal) => ({
      ...deal,
      stage: await getDealStage(deal.id),
      missingSignals: await getMissingSignals(deal.id),
    })),
  );

  const sorted = sortDealsByDisplayOrder(enriched);
  return NextResponse.json(sorted);
}
