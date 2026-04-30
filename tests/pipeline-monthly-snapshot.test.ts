import { AccountType, InteractionType, Outcome, StakeholderType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as monthlyPipelineGET } from "../app/api/pipeline/monthly/route";
import { POST as snapshotPOST } from "../app/api/pipeline/monthly/snapshot/route";
import {
  currentSnapshotMonth,
  generateMonthlySnapshot,
  MonthlySnapshotConflictError,
} from "../lib/pipeline/monthly-snapshot";
import { prismaTest as prisma } from "../lib/test-prisma";
import { json, makeRequest, resetDbAndSeedUsers, uniqueName } from "./helpers";

type MonthlyPipelineBody = {
  month: string;
  source: "live" | "snapshot";
  totalPipeline: number;
  totals: Record<string, { count: number; value: number }>;
  outcomes: Record<string, { count: number; value: number }>;
  perRepBreakdown: Array<{
    ownerId: string;
    ownerName: string;
    stages: Record<string, { count: number; value: number }>;
    outcomes: Record<string, { count: number; value: number }>;
    totalPipeline: number;
  }>;
};

async function createOwnedDeal(params: {
  ownerId: string;
  value: number;
  outcomes?: Outcome[];
  status?: "ACTIVE" | "EXPIRED";
}) {
  const name = uniqueName("MonthlyPipe");
  const account = await prisma.account.create({
    data: {
      name,
      normalized: name.toLowerCase(),
      type: AccountType.SCHOOL,
      state: "Maharashtra",
      district: "Mumbai City",
      createdById: params.ownerId,
      assignedToId: params.ownerId,
      status: "APPROVED",
    },
  });
  const deal = await prisma.deal.create({
    data: {
      name: "Product",
      companyName: name,
      value: params.value,
      accountId: account.id,
      ownerId: params.ownerId,
      status: params.status ?? "ACTIVE",
    },
  });
  for (const outcome of params.outcomes ?? []) {
    await prisma.interactionLog.create({
      data: {
        dealId: deal.id,
        interactionType: InteractionType.CALL,
        outcome,
        stakeholderType: StakeholderType.UNKNOWN,
      },
    });
  }
  return deal;
}

describe("monthly pipeline snapshots", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  const snapshotMonth = "2026-03";

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
  });

  it("groups active deals by owner and computed stage", async () => {
    await createOwnedDeal({ ownerId: users.rep.id, value: 100 });
    await createOwnedDeal({
      ownerId: users.rep.id,
      value: 250,
      outcomes: [Outcome.DEMO_DONE],
    });
    await createOwnedDeal({
      ownerId: users.rep2.id,
      value: 500,
      outcomes: [Outcome.DEAL_CONFIRMED, Outcome.PO_RECEIVED],
    });
    await createOwnedDeal({ ownerId: users.rep.id, value: 999, status: "EXPIRED" });

    const result = await generateMonthlySnapshot(snapshotMonth);
    const rows = await prisma.pipelineSnapshot.findMany({
      where: { month: snapshotMonth },
      orderBy: [{ ownerId: "asc" }, { stage: "asc" }],
    });

    expect(result.insertedCount).toBe(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerId: users.rep.id, stage: "ACCESS", totalValue: 100, dealCount: 1 }),
        expect.objectContaining({ ownerId: users.rep.id, stage: "EVALUATION", totalValue: 250, dealCount: 1 }),
        expect.objectContaining({ ownerId: users.rep2.id, stage: "CLOSED", totalValue: 500, dealCount: 1 }),
      ]),
    );
  });

  it("rejects duplicate snapshot generation without duplicating rows", async () => {
    await createOwnedDeal({ ownerId: users.rep.id, value: 100 });
    await generateMonthlySnapshot(snapshotMonth);
    await expect(generateMonthlySnapshot(snapshotMonth)).rejects.toBeInstanceOf(MonthlySnapshotConflictError);
    await expect(prisma.pipelineSnapshot.count({ where: { month: snapshotMonth } })).resolves.toBe(1);
  });

  it("retrieves snapshot totals and per-rep rows", async () => {
    await createOwnedDeal({ ownerId: users.rep.id, value: 100 });
    await createOwnedDeal({
      ownerId: users.rep.id,
      value: 250,
      outcomes: [Outcome.MET_DECISION_MAKER, Outcome.BUDGET_DISCUSSED],
    });
    await generateMonthlySnapshot(snapshotMonth);

    const res = await monthlyPipelineGET(
      makeRequest(`http://localhost/api/pipeline/monthly?month=${snapshotMonth}`, { userId: users.admin.id }),
    );
    const body = await json<MonthlyPipelineBody>(res);
    const repRow = body.perRepBreakdown.find((row) => row.ownerId === users.rep.id);

    expect(res.status).toBe(200);
    expect(body.source).toBe("snapshot");
    expect(body.totalPipeline).toBe(350);
    expect(body.totals.ACCESS).toEqual({ count: 1, value: 100 });
    expect(body.totals.QUALIFIED).toEqual({ count: 1, value: 250 });
    expect(repRow?.totalPipeline).toBe(350);
  });

  it("filters snapshot retrieval by requester role", async () => {
    await createOwnedDeal({ ownerId: users.rep.id, value: 100 });
    await createOwnedDeal({ ownerId: users.rep2.id, value: 300 });
    await generateMonthlySnapshot(snapshotMonth);

    const repRes = await monthlyPipelineGET(
      makeRequest(`http://localhost/api/pipeline/monthly?month=${snapshotMonth}`, { userId: users.rep.id }),
    );
    const repBody = await json<MonthlyPipelineBody>(repRes);
    expect(repBody.perRepBreakdown.map((row) => row.ownerId)).toEqual([users.rep.id]);
    expect(repBody.totalPipeline).toBe(100);

    const managerRes = await monthlyPipelineGET(
      makeRequest(`http://localhost/api/pipeline/monthly?month=${snapshotMonth}`, { userId: users.manager.id }),
    );
    const managerBody = await json<MonthlyPipelineBody>(managerRes);
    expect(managerBody.perRepBreakdown.map((row) => row.ownerId)).toEqual([users.rep.id]);
    expect(managerBody.totalPipeline).toBe(100);

    const adminRes = await monthlyPipelineGET(
      makeRequest(`http://localhost/api/pipeline/monthly?month=${snapshotMonth}`, { userId: users.admin.id }),
    );
    const adminBody = await json<MonthlyPipelineBody>(adminRes);
    expect(adminBody.perRepBreakdown.map((row) => row.ownerId).sort()).toEqual([users.rep.id, users.rep2.id].sort());
    expect(adminBody.totalPipeline).toBe(400);
  });

  it("uses live pipeline semantics for the current month", async () => {
    await createOwnedDeal({ ownerId: users.rep.id, value: 125 });

    const month = currentSnapshotMonth();
    const res = await monthlyPipelineGET(
      makeRequest(`http://localhost/api/pipeline/monthly?month=${month}`, { userId: users.admin.id }),
    );
    const body = await json<MonthlyPipelineBody>(res);

    expect(res.status).toBe(200);
    expect(body.source).toBe("live");
    expect(body.totalPipeline).toBe(125);
    expect(body.totals.ACCESS).toEqual({ count: 1, value: 125 });
  });

  it("allows only admins to trigger snapshots manually", async () => {
    await createOwnedDeal({ ownerId: users.rep.id, value: 100 });

    const forbidden = await snapshotPOST(
      makeRequest("http://localhost/api/pipeline/monthly/snapshot", {
        method: "POST",
        userId: users.rep.id,
        body: { month: snapshotMonth },
      }),
    );
    expect(forbidden.status).toBe(403);

    const created = await snapshotPOST(
      makeRequest("http://localhost/api/pipeline/monthly/snapshot", {
        method: "POST",
        userId: users.admin.id,
        body: { month: snapshotMonth },
      }),
    );
    expect(created.status).toBe(201);

    const duplicate = await snapshotPOST(
      makeRequest("http://localhost/api/pipeline/monthly/snapshot", {
        method: "POST",
        userId: users.admin.id,
        body: { month: snapshotMonth },
      }),
    );
    expect(duplicate.status).toBe(409);
  });
});
