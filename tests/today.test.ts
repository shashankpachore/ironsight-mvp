import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, UserRole } from "@prisma/client";
import { GET as getTodayRoute } from "../app/api/today/route";
import { addDaysYmd, formatYmdInIST, istYmdToUtcStart } from "../lib/ist-time";
import { prismaTest as prisma } from "../lib/test-prisma";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

function dayOffset(days: number): Date {
  const todayYmd = formatYmdInIST(new Date());
  return istYmdToUtcStart(addDaysYmd(todayYmd, days));
}

async function createAssignedDealForUser(params: {
  ownerId: string;
  adminId: string;
  label: string;
  coOwnerId?: string | null;
}) {
  const account = await json<{ id: string }>(
    await createAccount({ byUserId: params.adminId, name: uniqueName(`Today-${params.label}`) }),
  );
  await approveAccount({ byUserId: params.adminId, accountId: account.id });
  await assignAccount({
    byUserId: params.adminId,
    accountId: account.id,
    assigneeId: params.ownerId,
  });
  const dealRes = await createDeal({
    byUserId: params.ownerId,
    accountId: account.id,
    name: uniqueName(`Deal-${params.label}`),
    value: 1000,
    coOwnerId: params.coOwnerId,
  });
  return json<{ id: string }>(dealRes);
}

describe("today api", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("returns 401 without session", async () => {
    const res = await getTodayRoute(makeRequest("http://localhost/api/today"));
    expect(res.status).toBe(401);
  });

  it("groups deals into critical/attention/upcoming, applies sorting, and excludes inactive/no-next", async () => {
    const criticalOverdue = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "CriticalOverdue" })).id;
    const criticalStale = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "CriticalStale" })).id;
    const attentionA = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "AttentionA" })).id;
    const attentionB = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "AttentionB" })).id;
    const upcomingToday = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "UpcomingToday" })).id;
    const upcomingTwoDays = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "UpcomingTwoDays" })).id;
    const noNextStep = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "NoNextStep" })).id;
    const closedDeal = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "ClosedDeal" })).id;
    await createAssignedDealForUser({ ownerId: users.rep2.id, adminId: users.admin.id, label: "OtherRepCritical" });

    await prisma.deal.update({
      where: { id: criticalOverdue },
      data: { nextStepDate: dayOffset(-6), lastActivityAt: dayOffset(-2), nextStepType: "FOLLOW_UP_CALL" },
    });
    await prisma.deal.update({
      where: { id: criticalStale },
      data: { nextStepDate: dayOffset(5), lastActivityAt: dayOffset(-10), nextStepType: "MEETING" },
    });
    await prisma.deal.update({
      where: { id: attentionA },
      data: { nextStepDate: dayOffset(5), lastActivityAt: dayOffset(-8), nextStepType: "CHECK_IN" },
    });
    await prisma.deal.update({
      where: { id: attentionB },
      data: { nextStepDate: dayOffset(5), lastActivityAt: dayOffset(-7), nextStepType: "EMAIL" },
    });
    await prisma.deal.update({
      where: { id: upcomingToday },
      data: { nextStepDate: dayOffset(0), lastActivityAt: dayOffset(-1), nextStepType: "CALL" },
    });
    await prisma.deal.update({
      where: { id: upcomingTwoDays },
      data: { nextStepDate: dayOffset(2), lastActivityAt: dayOffset(-1), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: noNextStep },
      data: { nextStepDate: null, lastActivityAt: dayOffset(-20), nextStepType: null },
    });
    await prisma.deal.update({
      where: { id: closedDeal },
      data: { nextStepDate: dayOffset(-6), lastActivityAt: dayOffset(-12), nextStepType: "CLOSE" },
    });

    const closedLogOne = await prisma.interactionLog.create({
      data: {
        dealId: closedDeal,
        interactionType: "CALL",
        outcome: Outcome.DEAL_CONFIRMED,
        stakeholderType: "DECISION_MAKER",
        notes: "confirm",
      },
    });
    await prisma.interactionLog.create({
      data: {
        dealId: closedDeal,
        interactionType: "CALL",
        outcome: Outcome.PO_RECEIVED,
        stakeholderType: "DECISION_MAKER",
        notes: "po",
        createdAt: new Date(closedLogOne.createdAt.getTime() + 1000),
      },
    });

    const res = await getTodayRoute(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      mode: "REP";
      critical: Array<{ dealId: string; daysOverdue: number; daysSinceLastActivity: number }>;
      attention: Array<{ dealId: string; daysSinceLastActivity: number }>;
      upcoming: Array<{ dealId: string; nextStepDate: string }>;
    }>(res);
    expect(body.mode).toBe("REP");

    expect(body.critical.map((x) => x.dealId)).toEqual([criticalOverdue, criticalStale]);
    expect(body.attention.map((x) => x.dealId)).toEqual([attentionA, attentionB]);
    expect(body.upcoming.map((x) => x.dealId)).toEqual([upcomingToday, upcomingTwoDays]);

    const allIds = new Set([
      ...body.critical.map((x) => x.dealId),
      ...body.attention.map((x) => x.dealId),
      ...body.upcoming.map((x) => x.dealId),
    ]);
    expect(allIds.has(noNextStep)).toBe(false);
    expect(allIds.has(closedDeal)).toBe(false);
  });

  it("shows a co-owned deal once in the co-owner Today view", async () => {
    const coOwned = (await createAssignedDealForUser({
      ownerId: users.rep.id,
      adminId: users.admin.id,
      label: "CoOwnerToday",
      coOwnerId: users.rep2.id,
    })).id;
    await prisma.deal.update({
      where: { id: coOwned },
      data: { nextStepDate: dayOffset(0), lastActivityAt: dayOffset(-1), nextStepType: "FOLLOW_UP" },
    });

    const res = await getTodayRoute(makeRequest("http://localhost/api/today", { userId: users.rep2.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      mode: "REP";
      critical: Array<{ dealId: string }>;
      attention: Array<{ dealId: string }>;
      upcoming: Array<{ dealId: string }>;
    }>(res);
    const visibleIds = [
      ...body.critical.map((deal) => deal.dealId),
      ...body.attention.map((deal) => deal.dealId),
      ...body.upcoming.map((deal) => deal.dealId),
    ];
    expect(visibleIds.filter((dealId) => dealId === coOwned)).toHaveLength(1);
  });

  it("does not show participant-only deals in Today", async () => {
    const participantOnly = (await createAssignedDealForUser({
      ownerId: users.rep.id,
      adminId: users.admin.id,
      label: "ParticipantOnlyToday",
    })).id;
    await prisma.deal.update({
      where: { id: participantOnly },
      data: { nextStepDate: dayOffset(0), lastActivityAt: dayOffset(-1), nextStepType: "FOLLOW_UP" },
    });
    await prisma.interactionLog.create({
      data: {
        dealId: participantOnly,
        interactionType: "CALL",
        outcome: Outcome.NO_RESPONSE,
        stakeholderType: "UNKNOWN",
        participants: { create: [{ userId: users.rep2.id }] },
      },
    });

    const res = await getTodayRoute(makeRequest("http://localhost/api/today", { userId: users.rep2.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      mode: "REP";
      critical: Array<{ dealId: string }>;
      attention: Array<{ dealId: string }>;
      upcoming: Array<{ dealId: string }>;
    }>(res);
    const visible = new Set([
      ...body.critical.map((deal) => deal.dealId),
      ...body.attention.map((deal) => deal.dealId),
      ...body.upcoming.map((deal) => deal.dealId),
    ]);
    expect(visible.has(participantOnly)).toBe(false);
  });

  it("manager gets prioritized rep summary with stale/critical flags and drill-down", async () => {
    const repThree = await prisma.user.create({
      data: {
        name: "Rep Three",
        email: uniqueName("rep3") + "@ironsight.local",
        password: "test1234",
        role: UserRole.REP,
        managerId: users.manager.id,
      },
    });
    const managerOwn = (await createAssignedDealForUser({ ownerId: users.manager.id, adminId: users.admin.id, label: "MgrOwn" })).id;
    const repCritical = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "MgrRepCritical" })).id;
    const repYellow = (await createAssignedDealForUser({ ownerId: repThree.id, adminId: users.admin.id, label: "MgrRepYellow" })).id;

    await prisma.deal.update({
      where: { id: managerOwn },
      data: { nextStepDate: dayOffset(-3), lastActivityAt: dayOffset(-9), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: repCritical },
      data: { nextStepDate: dayOffset(-4), lastActivityAt: dayOffset(-11), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: repYellow },
      data: { nextStepDate: dayOffset(5), lastActivityAt: dayOffset(-7), nextStepType: "CHECK_IN" },
    });

    const managerRes = await getTodayRoute(makeRequest("http://localhost/api/today", { userId: users.manager.id }));
    expect(managerRes.status).toBe(200);
    const managerBody = await json<{
      mode: "MANAGER";
      reps: Array<{
        repId: string;
        color: "RED" | "YELLOW" | "GREEN";
        stale: boolean;
        hasCritical: boolean;
        criticalCount: number;
        attentionCount: number;
      }>;
      selectedRepId: string | null;
      drilldown: {
        critical: Array<{ dealId: string }>;
        attention: Array<{ dealId: string }>;
      };
    }>(managerRes);

    expect(managerBody.mode).toBe("MANAGER");
    expect(managerBody.reps.length).toBeGreaterThanOrEqual(1);
    expect(managerBody.reps.some((rep) => rep.repId === users.manager.id)).toBe(true);
    const repSummary = managerBody.reps.find((rep) => rep.repId === users.rep.id);
    expect(repSummary?.color).toBe("RED");
    expect(repSummary?.hasCritical).toBe(true);
    expect(repSummary?.stale).toBe(true);
    expect(managerBody.reps.some((rep) => rep.repId === repThree.id && rep.color === "YELLOW")).toBe(true);

    const drillRes = await getTodayRoute(
      makeRequest(`http://localhost/api/today?repId=${repThree.id}`, { userId: users.manager.id }),
    );
    expect(drillRes.status).toBe(200);
    const drillBody = await json<{
      mode: "MANAGER";
      selectedRepId: string | null;
      drilldown: { critical: Array<{ dealId: string }>; attention: Array<{ dealId: string }> };
    }>(drillRes);
    expect(drillBody.mode).toBe("MANAGER");
    expect(drillBody.selectedRepId).toBe(repThree.id);
    expect(drillBody.drilldown.attention.map((x) => x.dealId)).toContain(repYellow);

    const repDrillRes = await getTodayRoute(
      makeRequest(`http://localhost/api/today?repId=${users.rep.id}`, { userId: users.manager.id }),
    );
    expect(repDrillRes.status).toBe(200);
    const repDrillBody = await json<{
      mode: "MANAGER";
      selectedRepId: string | null;
      drilldown: { critical: Array<{ dealId: string }>; attention: Array<{ dealId: string }> };
    }>(repDrillRes);
    expect(repDrillBody.selectedRepId).toBe(users.rep.id);
    expect(repDrillBody.drilldown.critical.map((x) => x.dealId)).toContain(repCritical);

    const managerOwnRes = await getTodayRoute(
      makeRequest(`http://localhost/api/today?repId=${users.manager.id}`, { userId: users.manager.id }),
    );
    expect(managerOwnRes.status).toBe(200);
    const managerOwnBody = await json<{
      mode: "MANAGER";
      selectedRepId: string | null;
      drilldown: { critical: Array<{ dealId: string }>; attention: Array<{ dealId: string }> };
    }>(managerOwnRes);
    expect(managerOwnBody.selectedRepId).toBe(users.manager.id);
    expect(managerOwnBody.drilldown.critical.map((x) => x.dealId)).toContain(managerOwn);
  });

  it("admin sees unrestricted deals in today buckets", async () => {
    const repDeal = (await createAssignedDealForUser({ ownerId: users.rep.id, adminId: users.admin.id, label: "AdminRep" })).id;
    const rep2Deal = (await createAssignedDealForUser({ ownerId: users.rep2.id, adminId: users.admin.id, label: "AdminRep2" })).id;
    const mgrDeal = (await createAssignedDealForUser({ ownerId: users.manager.id, adminId: users.admin.id, label: "AdminMgr" })).id;

    await prisma.deal.update({
      where: { id: repDeal },
      data: { nextStepDate: dayOffset(-4), lastActivityAt: dayOffset(-8), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: rep2Deal },
      data: { nextStepDate: dayOffset(-3), lastActivityAt: dayOffset(-9), nextStepType: "FOLLOW_UP" },
    });
    await prisma.deal.update({
      where: { id: mgrDeal },
      data: { nextStepDate: dayOffset(-2), lastActivityAt: dayOffset(-7), nextStepType: "FOLLOW_UP" },
    });

    const res = await getTodayRoute(makeRequest("http://localhost/api/today", { userId: users.admin.id }));
    expect(res.status).toBe(200);
    const body = await json<{
      mode: "REP";
      critical: Array<{ dealId: string }>;
      attention: Array<{ dealId: string }>;
      upcoming: Array<{ dealId: string }>;
    }>(res);
    const visible = new Set([
      ...body.critical.map((d) => d.dealId),
      ...body.attention.map((d) => d.dealId),
      ...body.upcoming.map((d) => d.dealId),
    ]);
    expect(visible.has(repDeal)).toBe(true);
    expect(visible.has(rep2Deal)).toBe(true);
    expect(visible.has(mgrDeal)).toBe(true);
  });
});
