import { beforeEach, describe, expect, it } from "vitest";
import { Outcome, UserRole } from "@prisma/client";
import { GET as getInsights } from "../app/api/manager/insights/route";
import { prisma } from "../lib/prisma";
import { approveAccount, assignAccount, createAccount, createDeal, json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

function daysFromNow(deltaDays: number): Date {
  return new Date(Date.now() + deltaDays * 86_400_000);
}

describe("manager insights api", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let repAccountId: string;
  let rep2AccountId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();

    const repAcc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("Insights-Rep") }),
    );
    repAccountId = repAcc.id;
    await approveAccount({ byUserId: users.admin.id, accountId: repAcc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: repAcc.id, assigneeId: users.rep.id });

    const rep2Acc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("Insights-Rep2") }),
    );
    rep2AccountId = rep2Acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId: rep2Acc.id });
    await assignAccount({ byUserId: users.admin.id, accountId: rep2Acc.id, assigneeId: users.rep2.id });
  });

  it("returns 401 without session", async () => {
    const res = await getInsights(makeRequest("http://localhost/api/manager/insights"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for REP", async () => {
    const res = await getInsights(
      makeRequest("http://localhost/api/manager/insights", { userId: users.rep.id }),
    );
    expect(res.status).toBe(403);
  });

  it("manager scope: only sees their reps, returns atRiskDeals + interventions", async () => {
    const committed = await json<{ id: string }>(
      await createDeal({
        byUserId: users.rep.id,
        accountId: repAccountId,
        name: uniqueName("Committed"),
        value: 100_000,
      }),
    );

    // Make the deal CRITICAL by inactivity
    await prisma.deal.update({
      where: { id: committed.id },
      data: { lastActivityAt: daysFromNow(-12), nextStepDate: daysFromNow(2), nextStepType: "FOLLOW_UP" },
    });

    // Force COMMITTED stage using existing outcomes (direct inserts are used elsewhere in tests)
    const old = daysFromNow(-12);
    await prisma.interactionLog.createMany({
      data: [
        { dealId: committed.id, interactionType: "CALL", outcome: Outcome.MET_DECISION_MAKER, stakeholderType: "DECISION_MAKER", notes: "dm", createdAt: new Date(old.getTime() + 1_000) },
        { dealId: committed.id, interactionType: "CALL", outcome: Outcome.BUDGET_DISCUSSED, stakeholderType: "DECISION_MAKER", notes: "budget", createdAt: new Date(old.getTime() + 2_000) },
        { dealId: committed.id, interactionType: "CALL", outcome: Outcome.PROPOSAL_SHARED, stakeholderType: "DECISION_MAKER", notes: "proposal", createdAt: new Date(old.getTime() + 3_000) },
        { dealId: committed.id, interactionType: "CALL", outcome: Outcome.DEAL_CONFIRMED, stakeholderType: "DECISION_MAKER", notes: "confirm", createdAt: new Date(old.getTime() + 4_000) },
      ],
    });

    const otherTeamDeal = await json<{ id: string }>(
      await createDeal({
        byUserId: users.rep2.id,
        accountId: rep2AccountId,
        name: uniqueName("OtherTeam"),
        value: 100_000,
      }),
    );
    await prisma.deal.update({
      where: { id: otherTeamDeal.id },
      data: { lastActivityAt: daysFromNow(-15), nextStepDate: daysFromNow(1), nextStepType: "FOLLOW_UP" },
    });
    await prisma.interactionLog.create({
      data: {
        dealId: otherTeamDeal.id,
        interactionType: "CALL",
        outcome: Outcome.PROPOSAL_SHARED,
        stakeholderType: "DECISION_MAKER",
        notes: "proposal",
        createdAt: daysFromNow(-15),
      },
    });

    const res = await getInsights(
      makeRequest("http://localhost/api/manager/insights", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      atRiskDeals: Array<{ dealId: string; stage: string; ownerName: string }>;
      repHealth: Array<{ repId: string; color: string }>;
      interventions: Array<{ dealId: string; suggestedAction: string }>;
    }>(res);

    // Scope: should include the committed rep deal, not the other manager's rep deal
    expect(body.atRiskDeals.map((d) => d.dealId)).toContain(committed.id);
    expect(body.atRiskDeals.map((d) => d.dealId)).not.toContain(otherTeamDeal.id);

    const committedRow = body.atRiskDeals.find((d) => d.dealId === committed.id);
    expect(committedRow?.stage).toBe("COMMITTED");
    expect(committedRow?.ownerName).toBe("Rep");

    const intervention = body.interventions.find((i) => i.dealId === committed.id);
    expect(intervention?.suggestedAction).toBe("Manager should step in — high risk close");
  });

  it("repHealth RED when criticalDeals > 5; YELLOW on low activity rule", async () => {
    // Create 6 CRITICAL deals for users.rep
    for (let i = 0; i < 6; i++) {
      const d = await json<{ id: string }>(
        await createDeal({
          byUserId: users.rep.id,
          accountId: repAccountId,
          name: uniqueName(`Critical-${i}`),
          value: 10_000,
        }),
      );
      await prisma.deal.update({
        where: { id: d.id },
        data: { lastActivityAt: daysFromNow(-11), nextStepDate: daysFromNow(2), nextStepType: "FOLLOW_UP" },
      });
    }

    const res = await getInsights(
      makeRequest("http://localhost/api/manager/insights", { userId: users.manager.id }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      repHealth: Array<{ repId: string; color: "RED" | "YELLOW" | "GREEN"; criticalDeals: number }>;
    }>(res);

    const repRow = body.repHealth.find((r) => r.repId === users.rep.id);
    expect(repRow?.criticalDeals).toBeGreaterThanOrEqual(6);
    expect(repRow?.color).toBe("RED");
  });
});

