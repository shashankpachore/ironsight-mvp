import { DealStatus, DealTerminalStage, Outcome } from "@prisma/client";
import { validateInteractionLogAccess } from "@/lib/account-access";
import { getCurrentUser } from "@/lib/auth";
import { getDealStageFromOutcomes } from "@/lib/deals";
import { isRiskAllowedForStage, type RiskCategoryValue } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { validateLogInput, validateOutcomeGuardrails } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "user not found" }, { status: 401 });

    const body = await request.json();
    const error = validateLogInput(body);
    if (error) return Response.json({ error }, { status: 400 });

    const deal = await prisma.deal.findUnique({
      where: { id: body.dealId },
      include: { account: true },
    });
    if (!deal) return Response.json({ error: "deal not found" }, { status: 404 });
    const accessError = validateInteractionLogAccess({
      accountAssignedToId: deal.account.assignedToId,
      currentUserId: user.id,
    });
    if (accessError) {
      const status = accessError === "only assigned user can log interactions" ? 403 : 400;
      return Response.json({ error: accessError }, { status });
    }

    const existingLogs = await prisma.interactionLog.findMany({
      where: { dealId: body.dealId },
      select: { outcome: true },
    });
    const outcomeError = validateOutcomeGuardrails({
      outcome: body.outcome as Outcome,
      dealValue: deal.value,
      existingOutcomes: existingLogs.map((log) => log.outcome),
    });
    if (outcomeError) return Response.json({ error: outcomeError }, { status: 400 });

    const riskValues = (body.risks as RiskCategoryValue[]) ?? [];
    const postLogStage = getDealStageFromOutcomes([
      ...existingLogs.map((log) => log.outcome),
      body.outcome as Outcome,
    ]);
    const requiresRisk = postLogStage === "EVALUATION" || postLogStage === "COMMITTED" || postLogStage === "LOST";
    const disallowAnyRisk = postLogStage === "CLOSED";

    if (disallowAnyRisk && riskValues.length > 0) {
      return Response.json(
        { error: `risks must be empty when deal stage is ${postLogStage}` },
        { status: 400 },
      );
    }
    if (requiresRisk && riskValues.length < 1) {
      return Response.json(
        { error: `at least 1 risk required when deal stage is ${postLogStage}` },
        { status: 400 },
      );
    }
    if (
      !disallowAnyRisk &&
      riskValues.some((risk) => !isRiskAllowedForStage(postLogStage, risk))
    ) {
      return Response.json(
        { error: `one or more risks are not allowed for stage ${postLogStage}` },
        { status: 400 },
      );
    }

    const bodyRecord = body as Record<string, unknown>;
    const nextStepSource =
      bodyRecord.nextStepSource === "MANUAL" ? "MANUAL" : "AUTO";
    const isPoReceived = bodyRecord.outcome === Outcome.PO_RECEIVED;
    const nextStepType = bodyRecord.nextStepType as string | undefined;
    const nextStepDateRaw = bodyRecord.nextStepDate as string | undefined;
    let nextStepDate: Date | null = null;
    if (!isPoReceived) {
      if (!nextStepType || !nextStepDateRaw) {
        return Response.json(
          { error: "nextStepType and nextStepDate are required when outcome is not PO_RECEIVED" },
          { status: 400 },
        );
      }
      nextStepDate = new Date(nextStepDateRaw);
      if (Number.isNaN(nextStepDate.getTime())) {
        return Response.json({ error: "nextStepDate must be a valid date" }, { status: 400 });
      }
    }

    if (bodyRecord.outcome === Outcome.DEAL_DROPPED && postLogStage !== "LOST") {
      return Response.json({ error: "DEAL_DROPPED outcome must result in LOST stage" }, { status: 400 });
    }

    const shouldStampClosed = postLogStage === "CLOSED" && !deal.terminalStage;
    const shouldStampLost = postLogStage === "LOST" && !deal.terminalStage;

    const log = await prisma.$transaction(async (tx) => {
      const createdLog = await tx.interactionLog.create({
        data: {
          dealId: body.dealId,
          interactionType: body.interactionType,
          outcome: body.outcome,
          stakeholderType: body.stakeholderType,
          notes: body.notes || null,
          risks: {
            create: riskValues.map((risk) => ({ category: risk })),
          },
        },
        include: { risks: true },
      });

      await tx.deal.update({
        where: { id: body.dealId },
        data: {
          lastActivityAt: new Date(),
          status: deal.status === DealStatus.EXPIRED ? DealStatus.ACTIVE : undefined,
          nextStepType: isPoReceived ? null : nextStepType,
          nextStepDate: isPoReceived ? null : nextStepDate,
          nextStepSource: isPoReceived ? null : nextStepSource,
          terminalStage: shouldStampClosed
            ? DealTerminalStage.CLOSED
            : shouldStampLost
              ? DealTerminalStage.LOST
              : undefined,
          terminalOwnerId: shouldStampClosed || shouldStampLost ? deal.ownerId : undefined,
        },
      });

      return createdLog;
    });

    return Response.json({ success: true, logId: log.id, stage: postLogStage }, { status: 201 });
  } catch (err) {
    console.error("LOGS API ERROR:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
