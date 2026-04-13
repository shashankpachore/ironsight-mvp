import { AccountStatus, InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postLogRoute } from "../app/api/logs/route";
import { GET as getTodayRoute } from "../app/api/today/route";
import { prisma } from "../lib/test-prisma";
import { makeRequest, resetDbAndSeedUsers, type SeededUsers } from "./helpers";

function daysFromNow(deltaDays: number) {
  return new Date(Date.now() + deltaDays * 86_400_000);
}

describe("api core - next step enforcement and today", () => {
  let users: SeededUsers;
  let logDealId: string;
  let criticalDealId: string;
  let attentionDealId: string;
  let upcomingDealId: string;
  let rep2DealId: string;

  beforeAll(async () => {
    users = await resetDbAndSeedUsers();

    const repAccount = await prisma.account.create({
      data: {
        name: "ApiCore-Rep",
        normalized: "apicore-rep",
        createdById: users.admin.id,
        assignedToId: users.rep.id,
        status: AccountStatus.APPROVED,
      },
    });

    const rep2Account = await prisma.account.create({
      data: {
        name: "ApiCore-Rep2",
        normalized: "apicore-rep2",
        createdById: users.admin.id,
        assignedToId: users.rep2.id,
        status: AccountStatus.APPROVED,
      },
    });

    const logDeal = await prisma.deal.create({
      data: {
        name: "Core Product",
        companyName: "Core Co",
        value: 100_000,
        accountId: repAccount.id,
        ownerId: users.rep.id,
        nextStepType: "FOLLOW_UP",
        nextStepDate: daysFromNow(2),
        lastActivityAt: new Date(),
      },
    });
    logDealId = logDeal.id;

    const criticalDeal = await prisma.deal.create({
      data: {
        name: "Core Product",
        companyName: "Core Co",
        value: 100_000,
        accountId: repAccount.id,
        ownerId: users.rep.id,
        nextStepType: "FOLLOW_UP",
        nextStepDate: daysFromNow(-5),
        lastActivityAt: daysFromNow(-1),
      },
    });
    criticalDealId = criticalDeal.id;

    const attentionDeal = await prisma.deal.create({
      data: {
        name: "Core Product",
        companyName: "Core Co",
        value: 100_000,
        accountId: repAccount.id,
        ownerId: users.rep.id,
        nextStepType: "FOLLOW_UP",
        nextStepDate: daysFromNow(6),
        lastActivityAt: daysFromNow(-8),
      },
    });
    attentionDealId = attentionDeal.id;

    const upcomingDeal = await prisma.deal.create({
      data: {
        name: "Core Product",
        companyName: "Core Co",
        value: 100_000,
        accountId: repAccount.id,
        ownerId: users.rep.id,
        nextStepType: "FOLLOW_UP",
        nextStepDate: new Date(),
        lastActivityAt: daysFromNow(-1),
      },
    });
    upcomingDealId = upcomingDeal.id;

    const rep2Deal = await prisma.deal.create({
      data: {
        name: "Core Product",
        companyName: "Core Co",
        value: 100_000,
        accountId: rep2Account.id,
        ownerId: users.rep2.id,
        nextStepType: "FOLLOW_UP",
        nextStepDate: new Date(),
        lastActivityAt: daysFromNow(-1),
      },
    });
    rep2DealId = rep2Deal.id;
  });

  beforeEach(async () => {
    await prisma.interactionRisk.deleteMany();
    await prisma.interactionLog.deleteMany();

    // Keep fixtures stable per test without full DB wipe.
    await prisma.deal.update({
      where: { id: logDealId },
      data: {
        nextStepType: "FOLLOW_UP",
        nextStepDate: daysFromNow(2),
        lastActivityAt: new Date(),
      },
    });
    await prisma.deal.update({
      where: { id: criticalDealId },
      data: { nextStepDate: daysFromNow(-5), lastActivityAt: daysFromNow(-1) },
    });
    await prisma.deal.update({
      where: { id: attentionDealId },
      data: { nextStepDate: daysFromNow(6), lastActivityAt: daysFromNow(-8) },
    });
    await prisma.deal.update({
      where: { id: upcomingDealId },
      data: { nextStepDate: new Date(), lastActivityAt: daysFromNow(-1) },
    });
    await prisma.deal.update({
      where: { id: rep2DealId },
      data: { nextStepDate: new Date(), lastActivityAt: daysFromNow(-1) },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("POST /api/logs next-step validation", () => {
    it("fails with 400 when nextStepType is missing", async () => {
      const res = await postLogRoute(
        makeRequest("http://localhost/api/logs", {
          method: "POST",
          userId: users.rep.id,
          body: {
            dealId: logDealId,
            interactionType: InteractionType.CALL,
            outcome: Outcome.DEMO_DONE,
            stakeholderType: StakeholderType.DECISION_MAKER,
            risks: [RiskCategory.NO_ACCESS_TO_DM],
            nextStepDate: daysFromNow(1).toISOString(),
          },
        }),
      );

      expect(res.status).toBe(400);
    });

    it("fails with 400 when nextStepDate is missing", async () => {
      const res = await postLogRoute(
        makeRequest("http://localhost/api/logs", {
          method: "POST",
          userId: users.rep.id,
          body: {
            dealId: logDealId,
            interactionType: InteractionType.CALL,
            outcome: Outcome.DEMO_DONE,
            stakeholderType: StakeholderType.DECISION_MAKER,
            risks: [RiskCategory.NO_ACCESS_TO_DM],
            nextStepType: "SEND_PRICING",
          },
        }),
      );

      expect(res.status).toBe(400);
    });

    it("succeeds when both nextStepType and nextStepDate are provided", async () => {
      const nextStepDate = daysFromNow(3).toISOString();
      const res = await postLogRoute(
        makeRequest("http://localhost/api/logs", {
          method: "POST",
          userId: users.rep.id,
          body: {
            dealId: logDealId,
            interactionType: InteractionType.CALL,
            outcome: Outcome.DEMO_DONE,
            stakeholderType: StakeholderType.DECISION_MAKER,
            risks: [RiskCategory.NO_ACCESS_TO_DM],
            nextStepType: "SEND_PRICING",
            nextStepDate,
          },
        }),
      );

      expect(res.status).toBe(201);

      const updatedDeal = await prisma.deal.findUnique({ where: { id: logDealId } });
      expect(updatedDeal?.nextStepType).toBe("SEND_PRICING");
      expect(updatedDeal?.nextStepDate?.toISOString()).toBe(nextStepDate);
    });
  });

  describe("GET /api/today", () => {
    it("returns critical, attention, and upcoming buckets correctly", async () => {
      await prisma.deal.update({
        where: { id: logDealId },
        data: { nextStepDate: daysFromNow(10), lastActivityAt: daysFromNow(-1) },
      });

      const res = await getTodayRoute(
        makeRequest("http://localhost/api/today", { userId: users.rep.id }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        critical: unknown[];
        attention: unknown[];
        upcoming: unknown[];
      };
      expect(body.critical.length).toBe(1);
      expect(body.attention.length).toBe(1);
      expect(body.upcoming.length).toBe(1);
    });

    it("rep only sees their own deals", async () => {
      const res = await getTodayRoute(
        makeRequest("http://localhost/api/today", { userId: users.rep.id }),
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        critical: Array<{ dealId: string }>;
        attention: Array<{ dealId: string }>;
        upcoming: Array<{ dealId: string }>;
      };
      const visibleIds = new Set([
        ...body.critical.map((d) => d.dealId),
        ...body.attention.map((d) => d.dealId),
        ...body.upcoming.map((d) => d.dealId),
      ]);
      expect(visibleIds.has(rep2DealId)).toBe(false);
      expect(visibleIds.has(criticalDealId)).toBe(true);
      expect(visibleIds.has(attentionDealId)).toBe(true);
      expect(visibleIds.has(upcomingDealId)).toBe(true);
    });
  });
});
