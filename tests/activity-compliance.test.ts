import {
  AccountStatus,
  InteractionType,
  Outcome,
  RiskCategory,
  StakeholderType,
  UserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as complianceGET } from "../app/api/activity/compliance/route";
import { getComplianceWindows } from "../lib/ist-time";
import { getActivityComplianceRows } from "../lib/activity-compliance";
import { prismaTest as prisma } from "../lib/test-prisma";
import { createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

async function seedApprovedAccount(params: { adminId: string; assigneeId: string }) {
  return prisma.account.create({
    data: {
      name: uniqueName("CompAcct"),
      normalized: uniqueName("cnorm").toLowerCase(),
      createdById: params.adminId,
      assignedToId: params.assigneeId,
      status: AccountStatus.APPROVED,
    },
  });
}

/** Anchor `now` used with `getActivityComplianceRows({ now })` in logic tests. */
const COMPLIANCE_NOW = new Date("2026-06-10T12:00:00.000Z");

/** `n` full UTC days before `anchor` (24h steps; fine for window placement in tests). */
function daysAgo(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() - n * 86_400_000);
}

/** A timestamp on the IST “yesterday” window for `now`, at `hour` (0–23) IST-relative via window bounds. */
function yesterdayAt(now: Date, hour: number): Date {
  const w = getComplianceWindows(now);
  return new Date(w.yesterdayStartUtc.getTime() + hour * 60 * 60 * 1000);
}

describe("activity compliance API", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("returns 401 without session", async () => {
    const res = await complianceGET(makeRequest("http://localhost/api/activity/compliance"));
    expect(res.status).toBe(401);
  });

  it("rep gets 403", async () => {
    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.rep.id }),
    );
    expect(res.status).toBe(403);
  });

  it("manager gets 200 and only direct-report reps", async () => {
    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string }[];
    const ids = new Set(body.map((r) => r.userId));
    expect(ids.has(users.manager.id)).toBe(true);
    expect(ids.has(users.rep.id)).toBe(true);
    expect(ids.has(users.manager2.id)).toBe(false);
    expect(ids.has(users.rep2.id)).toBe(false);
    expect(body.length).toBe(2);
  });

  it("admin gets 200 and includes all managers and reps", async () => {
    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.admin.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string }[];
    const ids = new Set(body.map((r) => r.userId));
    expect(ids.has(users.manager.id)).toBe(true);
    expect(ids.has(users.manager2.id)).toBe(true);
    expect(ids.has(users.rep.id)).toBe(true);
    expect(ids.has(users.rep2.id)).toBe(true);
    expect(body.length).toBe(4);
  });

  it("response rows match expected shape; idle rep has zero activity", async () => {
    const idle = await prisma.user.create({
      data: {
        name: "Idle Rep",
        email: `idle-${Date.now()}@ironsight.local`,
        password: "test1234",
        role: UserRole.REP,
        managerId: users.manager.id,
      },
    });

    const res = await complianceGET(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      userId: string;
      name: string;
      yesterdayCount: number;
      weeklyActiveDays: number;
      lastActivityAt: string | null;
    }>;

    const idleRow = body.find((r) => r.userId === idle.id);
    expect(idleRow).toBeDefined();
    expect(idleRow!.yesterdayCount).toBe(0);
    expect(idleRow!.weeklyActiveDays).toBe(0);
    expect(idleRow!.lastActivityAt).toBeNull();
    for (const row of body) {
      expect(typeof row.userId).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.yesterdayCount).toBe("number");
      expect(typeof row.weeklyActiveDays).toBe("number");
      expect(row.lastActivityAt === null || typeof row.lastActivityAt === "string").toBe(true);
    }
  });
});

describe("activity compliance logic (getActivityComplianceRows)", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repDealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const account = await seedApprovedAccount({ adminId: users.admin.id, assigneeId: users.rep.id });
    const dealRes = await createDeal({
      byUserId: users.rep.id,
      name: uniqueName("ComplianceDeal"),
      value: 100,
      accountId: account.id,
    });
    repDealId = (await json<{ id: string }>(dealRes)).id;
  });

  async function createLog(dealId: string, createdAt: Date) {
    await prisma.interactionLog.create({
      data: {
        dealId,
        interactionType: InteractionType.CALL,
        outcome: Outcome.FOLLOW_UP_DONE,
        stakeholderType: StakeholderType.UNKNOWN,
        notes: "t",
        createdAt,
        risks: { create: [{ category: RiskCategory.NO_ACCESS_TO_DM }] },
      },
    });
  }

  it("yesterdayCount = 0 when there are no logs", async () => {
    const rows = await getActivityComplianceRows({
      viewer: { id: users.admin.id, role: UserRole.ADMIN },
      now: COMPLIANCE_NOW,
    });
    const repRow = rows.find((r) => r.userId === users.rep.id);
    expect(repRow?.yesterdayCount).toBe(0);
    expect(repRow?.weeklyActiveDays).toBe(0);
    expect(repRow?.lastActivityAt).toBeNull();
  });

  it("counts multiple logs on yesterday IST window", async () => {
    const t0 = yesterdayAt(COMPLIANCE_NOW, 2);
    const t1 = yesterdayAt(COMPLIANCE_NOW, 8);
    const t2 = yesterdayAt(COMPLIANCE_NOW, 20);
    await createLog(repDealId, t0);
    await createLog(repDealId, t1);
    await createLog(repDealId, t2);

    const rows = await getActivityComplianceRows({
      viewer: { id: users.admin.id, role: UserRole.ADMIN },
      now: COMPLIANCE_NOW,
    });
    const repRow = rows.find((r) => r.userId === users.rep.id);
    expect(repRow?.yesterdayCount).toBe(3);
  });

  it("weeklyActiveDays uses distinct IST dates, not raw log count", async () => {
    const y1 = yesterdayAt(COMPLIANCE_NOW, 4);
    const y2 = yesterdayAt(COMPLIANCE_NOW, 10);
    const y3 = yesterdayAt(COMPLIANCE_NOW, 22);
    await createLog(repDealId, y1);
    await createLog(repDealId, y2);
    await createLog(repDealId, y3);

    const rows = await getActivityComplianceRows({
      viewer: { id: users.admin.id, role: UserRole.ADMIN },
      now: COMPLIANCE_NOW,
    });
    const repRow = rows.find((r) => r.userId === users.rep.id);
    expect(repRow?.weeklyActiveDays).toBe(1);
  });

  it("lastActivityAt is the latest log timestamp for the rep", async () => {
    const older = daysAgo(COMPLIANCE_NOW, 5);
    const newer = yesterdayAt(COMPLIANCE_NOW, 18);
    await createLog(repDealId, older);
    await createLog(repDealId, newer);

    const rows = await getActivityComplianceRows({
      viewer: { id: users.admin.id, role: UserRole.ADMIN },
      now: COMPLIANCE_NOW,
    });
    const repRow = rows.find((r) => r.userId === users.rep.id);
    expect(repRow?.lastActivityAt?.getTime()).toBe(newer.getTime());
  });

  it("manager logic view includes manager row and excludes unrelated team", async () => {
    const rows = await getActivityComplianceRows({
      viewer: { id: users.manager.id, role: UserRole.MANAGER },
      now: COMPLIANCE_NOW,
    });
    const ids = new Set(rows.map((r) => r.userId));
    expect(ids.has(users.manager.id)).toBe(true);
    expect(ids.has(users.rep.id)).toBe(true);
    expect(ids.has(users.manager2.id)).toBe(false);
    expect(ids.has(users.rep2.id)).toBe(false);
  });
});
