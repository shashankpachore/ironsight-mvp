import { AccountStatus, Outcome, RiskCategory, StakeholderType, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as postLogRoute } from "../app/api/logs/route";
import { getSuggestedNextStep } from "../lib/next-step";
import { prisma } from "../lib/prisma";
import { createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

async function seedApprovedAccount(params: { adminId: string; assigneeId: string }) {
  return prisma.account.create({
    data: {
      name: uniqueName("NextAcct"),
      normalized: uniqueName("norm").toLowerCase(),
      createdById: params.adminId,
      assignedToId: params.assigneeId,
      status: AccountStatus.APPROVED,
    },
  });
}

function baseLogBody(dealId: string, overrides: Record<string, unknown> = {}) {
  return {
    dealId,
    interactionType: "CALL",
    outcome: "FOLLOW_UP_DONE",
    stakeholderType: "UNKNOWN",
    risks: ["NO_ACCESS_TO_DM"],
    notes: "note",
    nextStepType: "AWAIT_RESPONSE",
    nextStepDate: new Date("2026-04-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

describe("mandatory next step — POST /api/logs", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await seedApprovedAccount({ adminId: users.admin.id, assigneeId: users.rep.id });
    const dealRes = await createDeal({
      byUserId: users.rep.id,
      name: uniqueName("NextStepDeal"),
      value: 50,
      accountId: account.id,
    });
    dealId = (await json<{ id: string }>(dealRes)).id;
    await prisma.deal.update({
      where: { id: dealId },
      data: { nextStepType: null, nextStepDate: null, nextStepSource: null },
    });
  });

  it("fails 400 when nextStepType is missing", async () => {
    const body = baseLogBody(dealId);
    delete (body as Record<string, unknown>).nextStepType;
    const res = await postLogRoute(
      makeRequest("http://localhost/api/logs", { method: "POST", userId: users.rep.id, body }),
    );
    expect(res.status).toBe(400);
  });

  it("fails 400 when nextStepDate is missing", async () => {
    const body = baseLogBody(dealId);
    delete (body as Record<string, unknown>).nextStepDate;
    const res = await postLogRoute(
      makeRequest("http://localhost/api/logs", { method: "POST", userId: users.rep.id, body }),
    );
    expect(res.status).toBe(400);
  });

  it("succeeds 201 when both next step fields are provided", async () => {
    const res = await postLogRoute(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: baseLogBody(dealId, {
          nextStepType: "FOLLOW_UP",
          nextStepDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
        }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("updates deal nextStepType and nextStepDate after log creation", async () => {
    const nextDate = new Date("2026-05-15T00:00:00.000Z").toISOString();
    await postLogRoute(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: baseLogBody(dealId, { nextStepType: "SEND_PRICING", nextStepDate: nextDate }),
      }),
    );
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal?.nextStepType).toBe("SEND_PRICING");
    expect(deal?.nextStepDate?.toISOString()).toBe(nextDate);
  });

  it("deal without prior next step still accepts a log", async () => {
    const res = await postLogRoute(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: baseLogBody(dealId, {
          nextStepType: "OTHER",
          nextStepDate: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        }),
      }),
    );
    expect(res.status).toBe(201);
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(deal?.nextStepType).toBe("OTHER");
  });

  it("rep cannot log on another rep’s assigned deal (403)", async () => {
    const account = await seedApprovedAccount({ adminId: users.admin.id, assigneeId: users.rep2.id });
    const dealRes = await createDeal({
      byUserId: users.rep2.id,
      name: uniqueName("Rep2Deal"),
      value: 75,
      accountId: account.id,
    });
    const otherDealId = (await json<{ id: string }>(dealRes)).id;

    const res = await postLogRoute(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: baseLogBody(otherDealId),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("getSuggestedNextStep", () => {
  it("Demo Done → SEND_PRICING", () => {
    expect(getSuggestedNextStep(Outcome.DEMO_DONE).type).toBe("SEND_PRICING");
  });

  it("No Response → FOLLOW_UP", () => {
    expect(getSuggestedNextStep(Outcome.NO_RESPONSE).type).toBe("FOLLOW_UP");
  });

  it("Proposal Shared → FOLLOW_UP", () => {
    expect(getSuggestedNextStep(Outcome.PROPOSAL_SHARED).type).toBe("FOLLOW_UP");
  });
});
