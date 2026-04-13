import { AccountStatus, InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getUsersRoute, POST as postUsersRoute } from "../app/api/users/route";
import { GET as getAuditRoute } from "../app/api/audit/route";
import { GET as getComplianceRoute } from "../app/api/activity/compliance/route";
import { GET as getTodayRoute } from "../app/api/today/route";
import { POST as postLogsRoute } from "../app/api/logs/route";
import { prisma } from "../lib/test-prisma";
import { makeRequest, resetDbAndSeedUsers } from "./helpers";

function daysFromNow(deltaDays: number) {
  return new Date(Date.now() + deltaDays * 86_400_000);
}

async function createAssignedDeal(params: {
  adminId: string;
  ownerId: string;
  normalized: string;
}) {
  const account = await prisma.account.create({
    data: {
      name: `Boundary-${params.normalized}`,
      normalized: params.normalized,
      createdById: params.adminId,
      assignedToId: params.ownerId,
      status: AccountStatus.APPROVED,
    },
  });
  return prisma.deal.create({
    data: {
      name: "Core Product",
      companyName: "Boundary Co",
      value: 42_000,
      accountId: account.id,
      ownerId: params.ownerId,
      nextStepType: "FOLLOW_UP",
      nextStepDate: daysFromNow(1),
      lastActivityAt: daysFromNow(-1),
    },
  });
}

describe("access boundary and role enforcement", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("REP cannot access admin APIs", async () => {
    const usersRes = await getUsersRoute(makeRequest("http://localhost/api/users", { userId: users.rep.id }));
    const auditRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.rep.id }));
    const complianceRes = await getComplianceRoute(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.rep.id }),
    );

    expect(usersRes.status).toBe(403);
    expect(auditRes.status).toBe(403);
    expect(complianceRes.status).toBe(403);
  });

  it("REP cannot see another rep's deal in /api/today", async () => {
    const rep1Deal = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      normalized: "boundary-rep1",
    });
    const rep2Deal = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep2.id,
      normalized: "boundary-rep2",
    });

    const res = await getTodayRoute(makeRequest("http://localhost/api/today", { userId: users.rep.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      critical: Array<{ dealId: string }>;
      attention: Array<{ dealId: string }>;
      upcoming: Array<{ dealId: string }>;
    };
    const visible = new Set([
      ...body.critical.map((d) => d.dealId),
      ...body.attention.map((d) => d.dealId),
      ...body.upcoming.map((d) => d.dealId),
    ]);
    expect(visible.has(rep1Deal.id)).toBe(true);
    expect(visible.has(rep2Deal.id)).toBe(false);
  });

  it("REP cannot log activity on another rep's deal", async () => {
    const rep2Deal = await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep2.id,
      normalized: "boundary-rep2-log",
    });

    const res = await postLogsRoute(
      makeRequest("http://localhost/api/logs", {
        method: "POST",
        userId: users.rep.id,
        body: {
          dealId: rep2Deal.id,
          interactionType: InteractionType.CALL,
          outcome: Outcome.DEMO_DONE,
          stakeholderType: StakeholderType.DECISION_MAKER,
          risks: [RiskCategory.NO_ACCESS_TO_DM],
          nextStepType: "SEND_PRICING",
          nextStepDate: daysFromNow(2).toISOString(),
        },
      }),
    );

    expect(res.status).toBe(403);
  });

  it("MANAGER cannot drill down to non-team rep in /api/today", async () => {
    await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep.id,
      normalized: "boundary-rep1-manager-drill",
    });
    await createAssignedDeal({
      adminId: users.admin.id,
      ownerId: users.rep2.id,
      normalized: "boundary-rep2-manager-drill",
    });

    const res = await getTodayRoute(
      makeRequest(`http://localhost/api/today?repId=${users.rep2.id}`, { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: "MANAGER";
      selectedRepId: string | null;
      drilldown: { critical: Array<{ dealId: string }>; attention: Array<{ dealId: string }> };
    };
    expect(body.mode).toBe("MANAGER");
    expect(body.selectedRepId).not.toBe(users.rep2.id);
    expect([users.manager.id, users.rep.id]).toContain(body.selectedRepId);
  });

  it("MANAGER can view compliance but cannot perform admin-only user creation", async () => {
    const complianceRes = await getComplianceRoute(
      makeRequest("http://localhost/api/activity/compliance", { userId: users.manager.id }),
    );
    expect(complianceRes.status).toBe(200);

    const createUserRes = await postUsersRoute(
      makeRequest("http://localhost/api/users", {
        method: "POST",
        userId: users.manager.id,
        body: {
          name: "Rep New",
          email: "rep-new@ironsight.local",
          password: "test1234",
          role: "REP",
          managerId: users.manager.id,
        },
      }),
    );
    expect(createUserRes.status).toBe(403);
  });

  it("ADMIN can access users and audit APIs", async () => {
    const usersRes = await getUsersRoute(makeRequest("http://localhost/api/users", { userId: users.admin.id }));
    const auditRes = await getAuditRoute(makeRequest("http://localhost/api/audit", { userId: users.admin.id }));

    expect(usersRes.status).toBe(200);
    expect(auditRes.status).toBe(200);
  });

  it("unauthenticated request returns 401", async () => {
    const res = await getUsersRoute(makeRequest("http://localhost/api/users"));
    expect(res.status).toBe(401);
  });
});
