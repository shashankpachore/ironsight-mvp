import {
  AccountStatus,
  DealStatus,
  InteractionType,
  Outcome,
  StakeholderType,
  UserRole,
} from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";

const DAY_MS = 86_400_000;

type SeededUsers = {
  admin: { id: string; role: UserRole };
  manager: { id: string; role: UserRole };
  manager2: { id: string; role: UserRole };
  rep: { id: string; role: UserRole };
  rep2: { id: string; role: UserRole };
};

type RouteHandler = (request: Request) => Promise<Response>;

let dealsGET: RouteHandler;
let dealsPOST: RouteHandler;
let expiredDealsGET: RouteHandler;
let logsPOST: RouteHandler;
let pipelineGET: RouteHandler;
let todayGET: RouteHandler;

function makeRequest(url: string, init?: { method?: string; body?: unknown; userId?: string }) {
  const headers = new Headers();
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  if (init?.userId) headers.set("x-user-id", init.userId);
  return new Request(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

async function resetDbAndSeedUsers(): Promise<SeededUsers> {
  await prisma.interactionRisk.deleteMany();
  await prisma.interactionLog.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.account.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.updateMany({ data: { managerId: null } });
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: { name: "Admin", email: uniqueName("admin") + "@ironsight.local", password: "test1234", role: "ADMIN" },
  });
  const manager = await prisma.user.create({
    data: { name: "Manager", email: uniqueName("manager") + "@ironsight.local", password: "test1234", role: "MANAGER" },
  });
  const manager2 = await prisma.user.create({
    data: { name: "Manager Two", email: uniqueName("manager2") + "@ironsight.local", password: "test1234", role: "MANAGER" },
  });
  const rep = await prisma.user.create({
    data: { name: "Rep", email: uniqueName("rep") + "@ironsight.local", password: "test1234", role: "REP", managerId: manager.id },
  });
  const rep2 = await prisma.user.create({
    data: { name: "Rep Two", email: uniqueName("rep2") + "@ironsight.local", password: "test1234", role: "REP", managerId: manager2.id },
  });

  return {
    admin: { id: admin.id, role: UserRole.ADMIN },
    manager: { id: manager.id, role: UserRole.MANAGER },
    manager2: { id: manager2.id, role: UserRole.MANAGER },
    rep: { id: rep.id, role: UserRole.REP },
    rep2: { id: rep2.id, role: UserRole.REP },
  };
}

async function createAssignedDeal(params: {
  adminId: string;
  ownerId: string;
  label: string;
  lastActivityAt: Date;
  status?: DealStatus;
  nextStepDate?: Date | null;
}) {
  const normalized = uniqueName(`expiry-${params.label}`).toLowerCase();
  const account = await prisma.account.create({
    data: {
      name: uniqueName(`Expiry-${params.label}`),
      normalized,
      createdById: params.adminId,
      assignedToId: params.ownerId,
      status: AccountStatus.APPROVED,
    },
  });
  return prisma.deal.create({
    data: {
      name: "Expiry Deal",
      companyName: account.name,
      value: 10_000,
      accountId: account.id,
      ownerId: params.ownerId,
      status: params.status ?? DealStatus.ACTIVE,
      lastActivityAt: params.lastActivityAt,
      nextStepType: params.nextStepDate === null ? null : "FOLLOW_UP",
      nextStepDate: params.nextStepDate === undefined ? daysFromNow(1) : params.nextStepDate,
    },
  });
}

beforeAll(async () => {
  const dealsRoute = await import("../app/api/deals/route");
  const expiredDealsRoute = await import("../app/api/deals/expired/route");
  const logsRoute = await import("../app/api/logs/route");
  const pipelineRoute = await import("../app/api/pipeline/route");
  const todayRoute = await import("../app/api/today/route");

  dealsGET = dealsRoute.GET;
  dealsPOST = dealsRoute.POST;
  expiredDealsGET = expiredDealsRoute.GET;
  logsPOST = logsRoute.POST;
  pipelineGET = pipelineRoute.GET;
  todayGET = todayRoute.GET;
});

describe("deal expiry lifecycle", () => {
  let users: SeededUsers;

  beforeEach(async () => {
    process.env.TEST_MODE = "true";
    users = await resetDbAndSeedUsers();
  });

  it("creates deals as ACTIVE by default", async () => {
    const account = await prisma.account.create({
      data: {
        name: uniqueName("Expiry-Default"),
        normalized: uniqueName("expiry-default").toLowerCase(),
        createdById: users.admin.id,
        assignedToId: users.rep.id,
        status: AccountStatus.APPROVED,
      },
    });

    const res = await dealsPOST(
      makeRequest("http://localhost/api/deals", {
        method: "POST",
        userId: users.rep.id,
        body: {
          name: PRODUCT_OPTIONS[0],
          value: 25_000,
          accountId: account.id,
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: DealStatus };
    expect(body.status).toBe(DealStatus.ACTIVE);

    const deal = await prisma.deal.findUnique({ where: { id: body.id } });
    expect(deal?.status).toBe(DealStatus.ACTIVE);
  });

  it("expires stale active deals on /api/deals read and omits them from the response", async () => {
    const recent = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "Recent",
      lastActivityAt: daysAgo(3),
    });
    const stale = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "Stale",
      lastActivityAt: daysAgo(46),
    });

    const res = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    const ids = new Set(body.map((deal) => deal.id));
    expect(ids.has(recent.id)).toBe(true);
    expect(ids.has(stale.id)).toBe(false);

    const updated = await prisma.deal.findUnique({ where: { id: stale.id } });
    expect(updated?.status).toBe(DealStatus.EXPIRED);
  });

  it("excludes read-time expired deals from pipeline and today responses", async () => {
    const recent = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "PipelineRecent",
      lastActivityAt: daysAgo(1),
      nextStepDate: new Date(),
    });
    const stale = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "PipelineStale",
      lastActivityAt: daysAgo(46),
      nextStepDate: new Date(),
    });

    const pipelineRes = await pipelineGET(
      makeRequest("http://localhost/api/pipeline", { userId: users.rep.id }),
    );
    expect(pipelineRes.status).toBe(200);
    const pipeline = (await pipelineRes.json()) as Record<string, { count: number }>;
    expect(Object.values(pipeline).reduce((sum, stage) => sum + stage.count, 0)).toBe(1);

    const todayRes = await todayGET(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
    expect(todayRes.status).toBe(200);
    const today = (await todayRes.json()) as {
      critical: Array<{ dealId: string }>;
      attention: Array<{ dealId: string }>;
      upcoming: Array<{ dealId: string }>;
    };
    const todayIds = new Set([
      ...today.critical.map((deal) => deal.dealId),
      ...today.attention.map((deal) => deal.dealId),
      ...today.upcoming.map((deal) => deal.dealId),
    ]);
    expect(todayIds.has(recent.id)).toBe(true);
    expect(todayIds.has(stale.id)).toBe(false);
  });

  it("marks 30-44 day inactive deals as expiring soon in deals and today responses", async () => {
    const day35 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "Expiring35",
      lastActivityAt: daysAgo(35),
      nextStepDate: new Date(),
    });
    const day44 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "Expiring44",
      lastActivityAt: daysAgo(44),
      nextStepDate: new Date(),
    });
    const day46 = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "Expired46",
      lastActivityAt: daysAgo(46),
      nextStepDate: new Date(),
    });

    const dealsRes = await dealsGET(makeRequest("http://localhost/api/deals", { userId: users.rep.id }));
    expect(dealsRes.status).toBe(200);
    const deals = (await dealsRes.json()) as Array<{
      id: string;
      expiryWarning: "EXPIRING_SOON" | "EXPIRED" | null;
      daysToExpiry: number | null;
    }>;
    const warning35 = deals.find((deal) => deal.id === day35.id);
    const warning44 = deals.find((deal) => deal.id === day44.id);
    expect(warning35?.expiryWarning).toBe("EXPIRING_SOON");
    expect(warning35?.daysToExpiry).toBe(10);
    expect(warning44?.expiryWarning).toBe("EXPIRING_SOON");
    expect(warning44?.daysToExpiry).toBe(1);
    expect(deals.some((deal) => deal.id === day46.id)).toBe(false);

    const todayRes = await todayGET(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
    expect(todayRes.status).toBe(200);
    const today = (await todayRes.json()) as {
      attention: Array<{
        dealId: string;
        reason: string;
        actionMessage: string;
      }>;
      critical: Array<{
        dealId: string;
        reason: string;
        actionMessage: string;
      }>;
    };
    expect(today.attention.find((deal) => deal.dealId === day35.id)).toBeUndefined();
    const critical35 = today.critical.find((deal) => deal.dealId === day35.id);
    expect(critical35).toMatchObject({
      reason: "Deal nearing expiry due to inactivity",
      actionMessage: "Take action before deal expires",
    });
  });

  it("resurrects an expired deal when a new interaction is logged", async () => {
    const expired = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "Resurrect",
      lastActivityAt: daysAgo(50),
      status: DealStatus.EXPIRED,
    });

    const res = await logsPOST(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId: expired.id,
          interactionType: InteractionType.CALL,
          outcome: Outcome.FOLLOW_UP_DONE,
          stakeholderType: StakeholderType.UNKNOWN,
          risks: [],
          nextStepType: "FOLLOW_UP",
          nextStepDate: daysFromNow(2).toISOString(),
        },
      }),
    );
    expect(res.status).toBe(201);

    const updated = await prisma.deal.findUnique({ where: { id: expired.id } });
    expect(updated?.status).toBe(DealStatus.ACTIVE);
  });

  it("returns only access-scoped expired deals from /api/deals/expired", async () => {
    const ownExpired = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      label: "OwnExpired",
      lastActivityAt: daysAgo(50),
      status: DealStatus.EXPIRED,
    });
    const otherExpired = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep2.id,
      label: "OtherExpired",
      lastActivityAt: daysAgo(55),
      status: DealStatus.EXPIRED,
    });

    const res = await expiredDealsGET(
      makeRequest("http://localhost/api/deals/expired", { userId: users.rep.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; daysSinceLastActivity: number }>;
    const ids = new Set(body.map((deal) => deal.id));
    expect(ids.has(ownExpired.id)).toBe(true);
    expect(ids.has(otherExpired.id)).toBe(false);
    expect(body.find((deal) => deal.id === ownExpired.id)?.daysSinceLastActivity).toBeGreaterThanOrEqual(45);
  });
});
