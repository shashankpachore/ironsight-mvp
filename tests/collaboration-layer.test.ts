import { beforeEach, describe, expect, it } from "vitest";
import { AccountStatus, Outcome, UserRole } from "@prisma/client";
import { GET as dealsGET } from "../app/api/deals/route";
import { GET as dealGET, PATCH as dealPATCH } from "../app/api/deals/[id]/route";
import { GET as logsGET } from "../app/api/logs/[dealId]/route";
import { POST as logsPOST } from "../app/api/logs/route";
import { GET as pipelineGET } from "../app/api/pipeline/route";
import { GET as todayGET } from "../app/api/today/route";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";
import {
  approveAccount,
  assignAccount,
  createAccount,
  createDeal,
  json,
  logInteraction,
  makeRequest,
  resetDbAndSeedUsers,
  uniqueName,
} from "./helpers";

function daysFromNow(deltaDays: number) {
  return new Date(Date.now() + deltaDays * 86_400_000);
}

function allTodayDealIds(body: {
  critical?: Array<{ dealId: string }>;
  attention?: Array<{ dealId: string }>;
  upcoming?: Array<{ dealId: string }>;
}) {
  return [
    ...(body.critical ?? []).map((deal) => deal.dealId),
    ...(body.attention ?? []).map((deal) => deal.dealId),
    ...(body.upcoming ?? []).map((deal) => deal.dealId),
  ];
}

function totalCount(pipeline: Record<string, { count: number }>) {
  return Object.values(pipeline).reduce((sum, stage) => sum + stage.count, 0);
}

function totalValue(pipeline: Record<string, { value: number }>) {
  return Object.values(pipeline).reduce((sum, stage) => sum + stage.value, 0);
}

async function createApprovedAssignedDeal(params: {
  adminId: string;
  ownerId: string;
  coOwnerId?: string | null;
  value?: number;
}) {
  const account = await json<{ id: string }>(
    await createAccount({ byUserId: params.adminId, name: uniqueName("CollabAccount") }),
  );
  await approveAccount({ byUserId: params.adminId, accountId: account.id });
  await assignAccount({ byUserId: params.adminId, accountId: account.id, assigneeId: params.ownerId });
  const deal = await json<{ id: string }>(
    await createDeal({
      byUserId: params.ownerId,
      accountId: account.id,
      name: PRODUCT_OPTIONS[0],
      value: params.value ?? 100,
      coOwnerId: params.coOwnerId,
    }),
  );
  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      nextStepType: "FOLLOW_UP",
      nextStepDate: daysFromNow(1),
      lastActivityAt: daysFromNow(-1),
    },
  });
  return { accountId: account.id, dealId: deal.id };
}

describe("collaboration layer", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let unrelatedRep: { id: string; role: UserRole };

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    unrelatedRep = await prisma.user.create({
      data: {
        name: "Unrelated Rep",
        email: `${uniqueName("unrelated")}@ironsight.local`,
        password: "test1234",
        role: UserRole.REP,
        managerId: users.manager2.id,
      },
      select: { id: true, role: true },
    });
  });

  describe("access boundaries", () => {
    it("owner and co-owner can see a deal while unrelated and participant-only users cannot", async () => {
      const { dealId } = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
        coOwnerId: users.rep2.id,
      });
      await logInteraction({
        byUserId: users.rep.id,
        dealId,
        outcome: Outcome.NO_RESPONSE,
        participants: [unrelatedRep.id],
      });

      const ownerRes = await dealGET(makeRequest(`http://localhost/api/deals/${dealId}`, { userId: users.rep.id }), {
        params: Promise.resolve({ id: dealId }),
      });
      const coOwnerRes = await dealGET(
        makeRequest(`http://localhost/api/deals/${dealId}`, { userId: users.rep2.id }),
        { params: Promise.resolve({ id: dealId }) },
      );
      const unrelatedRes = await dealGET(
        makeRequest(`http://localhost/api/deals/${dealId}`, { userId: unrelatedRep.id }),
        { params: Promise.resolve({ id: dealId }) },
      );

      expect(ownerRes.status).toBe(200);
      expect(coOwnerRes.status).toBe(200);
      expect(unrelatedRes.status).toBe(403);
    });
  });

  describe("manager hierarchy", () => {
    it("manager sees reportee-owned and reportee-co-owned deals, but not unrelated hierarchy deals", async () => {
      const reporteeOwned = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
      });
      const reporteeCoOwned = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.manager2.id,
        coOwnerId: users.rep.id,
      });
      const unrelated = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: unrelatedRep.id,
      });

      const res = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
      expect(res.status).toBe(200);
      const rows = await json<Array<{ id: string }>>(res);
      const visible = new Set(rows.map((deal) => deal.id));

      expect(visible.has(reporteeOwned.dealId)).toBe(true);
      expect(visible.has(reporteeCoOwned.dealId)).toBe(true);
      expect(visible.has(unrelated.dealId)).toBe(false);
    });
  });

  describe("logging permissions", () => {
    it("owner and co-owner can create logs, but participant-only and unrelated users cannot", async () => {
      const { dealId } = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
        coOwnerId: users.rep2.id,
      });
      const ownerLog = await logInteraction({ byUserId: users.rep.id, dealId, outcome: Outcome.NO_RESPONSE });
      const coOwnerLog = await logInteraction({ byUserId: users.rep2.id, dealId, outcome: Outcome.FOLLOW_UP_DONE });
      const participantOnlyLog = await logInteraction({
        byUserId: unrelatedRep.id,
        dealId,
        outcome: Outcome.NO_RESPONSE,
      });

      expect(ownerLog.status).toBe(201);
      expect(coOwnerLog.status).toBe(201);
      expect(participantOnlyLog.status).toBe(403);
    });
  });

  describe("deduplication", () => {
    it("co-owner matching existing manager scope still appears once in /api/deals and /api/today", async () => {
      const { dealId } = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.manager.id,
        coOwnerId: users.manager2.id,
      });

      const dealsRes = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.manager.id }));
      const deals = await json<Array<{ id: string }>>(dealsRes);
      expect(deals.filter((deal) => deal.id === dealId)).toHaveLength(1);

      const todayRes = await todayGET(makeRequest("http://localhost/api/today", { userId: users.manager.id }));
      const today = await json<{
        mode: "MANAGER";
        drilldown: {
          critical: Array<{ dealId: string }>;
          attention: Array<{ dealId: string }>;
          upcoming: Array<{ dealId: string }>;
        };
      }>(todayRes);
      expect(allTodayDealIds(today.drilldown).filter((id) => id === dealId)).toHaveLength(1);
    });
  });

  describe("co-owner constraints", () => {
    it("rejects same owner/co-owner, invalid rep-owned manager co-owner, and array co-owner payloads", async () => {
      const { accountId } = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
      });

      const sameOwner = await createDeal({
        byUserId: users.rep.id,
        accountId,
        name: PRODUCT_OPTIONS[0],
        value: 100,
        coOwnerId: users.rep.id,
      });
      const managerCoOwner = await createDeal({
        byUserId: users.rep.id,
        accountId,
        name: PRODUCT_OPTIONS[0],
        value: 100,
        coOwnerId: users.manager.id,
      });
      const arrayCoOwner = await dealPATCH(
        makeRequest(`http://localhost/api/deals/${(await prisma.deal.findFirstOrThrow({ where: { accountId } })).id}`, {
          method: "PATCH",
          userId: users.rep.id,
          body: { coOwnerId: [users.rep2.id, unrelatedRep.id] },
        }),
        { params: Promise.resolve({ id: (await prisma.deal.findFirstOrThrow({ where: { accountId } })).id }) },
      );

      expect(sameOwner.status).toBe(400);
      expect(managerCoOwner.status).toBe(400);
      expect(arrayCoOwner.status).toBe(400);
    });
  });

  describe("reassignment", () => {
    it("keeps a valid co-owner across owner reassignment and clears conflicts with new owner", async () => {
      const keepCase = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
        coOwnerId: unrelatedRep.id,
      });
      await assignAccount({ byUserId: users.admin.id, accountId: keepCase.accountId, assigneeId: users.rep2.id });
      await expect(
        prisma.deal.findUnique({ where: { id: keepCase.dealId }, select: { ownerId: true, coOwnerId: true } }),
      ).resolves.toMatchObject({ ownerId: users.rep2.id, coOwnerId: unrelatedRep.id });

      const clearCase = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
        coOwnerId: users.rep2.id,
      });
      await assignAccount({ byUserId: users.admin.id, accountId: clearCase.accountId, assigneeId: users.rep2.id });
      await expect(
        prisma.deal.findUnique({ where: { id: clearCase.dealId }, select: { ownerId: true, coOwnerId: true } }),
      ).resolves.toMatchObject({ ownerId: users.rep2.id, coOwnerId: null });
    });
  });

  describe("participants", () => {
    it("saves, deduplicates, returns participants, and does not grant deal visibility", async () => {
      const { dealId } = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
      });
      const logRes = await logInteraction({
        byUserId: users.rep.id,
        dealId,
        outcome: Outcome.NO_RESPONSE,
        participants: [users.manager.id, unrelatedRep.id],
      });
      const duplicateRes = await logInteraction({
        byUserId: users.rep.id,
        dealId,
        outcome: Outcome.FOLLOW_UP_DONE,
        participants: [users.manager.id, users.manager.id],
      });
      const logsRes = await logsGET(makeRequest(`http://localhost/api/logs/${dealId}`, { userId: users.rep.id }), {
        params: Promise.resolve({ dealId }),
      });
      const participantVisibilityRes = await dealGET(
        makeRequest(`http://localhost/api/deals/${dealId}`, { userId: unrelatedRep.id }),
        { params: Promise.resolve({ id: dealId }) },
      );

      expect(logRes.status).toBe(201);
      expect(duplicateRes.status).toBe(400);
      expect(logsRes.status).toBe(200);
      const logs = await json<Array<{ participants: Array<{ id: string }> }>>(logsRes);
      expect(logs[0].participants.map((participant) => participant.id).sort()).toEqual(
        [users.manager.id, unrelatedRep.id].sort(),
      );
      expect(participantVisibilityRes.status).toBe(403);
    });
  });

  describe("pipeline integrity", () => {
    it("counts co-owned deals once and keeps owner-only attribution", async () => {
      await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
        coOwnerId: users.rep2.id,
        value: 100,
      });
      await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep2.id,
        value: 300,
      });

      const adminRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.admin.id }));
      const adminPipeline = await json<Record<string, { count: number; value: number }>>(adminRes);
      const ownerRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep.id }));
      const ownerPipeline = await json<Record<string, { count: number; value: number }>>(ownerRes);
      const coOwnerRes = await pipelineGET(makeRequest("http://localhost/api/pipeline", { userId: users.rep2.id }));
      const coOwnerPipeline = await json<Record<string, { count: number; value: number }>>(coOwnerRes);

      expect(totalCount(adminPipeline)).toBe(2);
      expect(totalValue(adminPipeline)).toBe(400);
      expect(totalValue(ownerPipeline)).toBe(100);
      expect(totalValue(coOwnerPipeline)).toBe(400);
    });
  });

  describe("today view", () => {
    it("owner and co-owner see a deal once, but participant-only user does not", async () => {
      const { dealId } = await createApprovedAssignedDeal({
        adminId: users.admin.id,
        ownerId: users.rep.id,
        coOwnerId: users.rep2.id,
      });
      await logInteraction({
        byUserId: users.rep.id,
        dealId,
        outcome: Outcome.NO_RESPONSE,
        participants: [unrelatedRep.id],
      });

      const ownerToday = await todayGET(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
      const coOwnerToday = await todayGET(makeRequest("http://localhost/api/today", { userId: users.rep2.id }));
      const participantToday = await todayGET(makeRequest("http://localhost/api/today", { userId: unrelatedRep.id }));

      const ownerIds = allTodayDealIds(await json(await ownerToday));
      const coOwnerIds = allTodayDealIds(await json(await coOwnerToday));
      const participantIds = allTodayDealIds(await json(await participantToday));
      expect(ownerIds.filter((id) => id === dealId)).toHaveLength(1);
      expect(coOwnerIds.filter((id) => id === dealId)).toHaveLength(1);
      expect(participantIds).not.toContain(dealId);
    });
  });
});
