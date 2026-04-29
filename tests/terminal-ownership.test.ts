import { beforeEach, describe, expect, it } from "vitest";
import { InteractionType, Outcome, RiskCategory, StakeholderType } from "@prisma/client";
import {
  approveAccount,
  assignAccount,
  createAccount,
  createDeal,
  json,
  logInteraction,
  resetDbAndSeedUsers,
  uniqueName,
} from "./helpers";
import { PRODUCT_OPTIONS } from "../lib/products";
import { prismaTest as prisma } from "../lib/test-prisma";

describe("terminal ownership stamping", () => {
  let users: Awaited<ReturnType<typeof resetDbAndSeedUsers>>;
  let accountId: string;
  let dealId: string;

  beforeEach(async () => {
    users = await resetDbAndSeedUsers();
    const acc = await json<{ id: string }>(
      await createAccount({ byUserId: users.admin.id, name: uniqueName("TerminalOwner") }),
    );
    accountId = acc.id;
    await approveAccount({ byUserId: users.admin.id, accountId });
    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep.id });
    const deal = await json<{ id: string }>(
      await createDeal({
        byUserId: users.rep.id,
        accountId,
        value: 100,
        name: PRODUCT_OPTIONS[0],
      }),
    );
    dealId = deal.id;
  });

  async function seedClosePrerequisites() {
    await prisma.interactionLog.createMany({
      data: [
        {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.MET_DECISION_MAKER,
          stakeholderType: StakeholderType.DECISION_MAKER,
        },
        {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.BUDGET_DISCUSSED,
          stakeholderType: StakeholderType.DECISION_MAKER,
        },
        {
          dealId,
          interactionType: InteractionType.CALL,
          outcome: Outcome.PROPOSAL_SHARED,
          stakeholderType: StakeholderType.DECISION_MAKER,
        },
      ],
    });
  }

  it("stamps terminal LOST with owner at stamp time", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_PREFERRED],
      notes: "Deal lost to competitor",
    });

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { ownerId: true, terminalStage: true, terminalOwnerId: true },
    });
    expect(deal?.terminalStage).toBe("LOST");
    expect(deal?.terminalOwnerId).toBe(deal?.ownerId);
    expect(deal?.terminalOwnerId).toBe(users.rep.id);
  });

  it("stamps terminal CLOSED with owner at stamp time", async () => {
    await seedClosePrerequisites();
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.DEAL_CONFIRMED,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_INVOLVED],
      notes: "Deal confirmed",
    });
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.PO_RECEIVED,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [],
      notes: "PO received",
    });

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { ownerId: true, terminalStage: true, terminalOwnerId: true },
    });
    expect(deal?.terminalStage).toBe("CLOSED");
    expect(deal?.terminalOwnerId).toBe(deal?.ownerId);
    expect(deal?.terminalOwnerId).toBe(users.rep.id);
  });

  it("does not mutate terminal fields after they are stamped", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_PREFERRED],
      notes: "Initial loss",
    });
    const stamped = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });

    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.FOLLOW_UP_DONE,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_PREFERRED],
      notes: "Follow-up logged after terminal stamp",
    });
    const after = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });

    expect(stamped?.terminalStage).toBe("LOST");
    expect(after?.terminalStage).toBe(stamped?.terminalStage);
    expect(after?.terminalOwnerId).toBe(stamped?.terminalOwnerId);
    expect(after?.terminalOwnerId).toBe(users.rep.id);
  });

  it("keeps LOST terminal ownership unchanged after reassignment", async () => {
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.LOST_TO_COMPETITOR,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_PREFERRED],
      notes: "Lost before reassignment",
    });
    const stamped = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });

    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const after = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });

    expect(stamped?.terminalStage).toBe("LOST");
    expect(after?.terminalStage).toBe("LOST");
    expect(after?.terminalOwnerId).toBe(stamped?.terminalOwnerId);
    expect(after?.terminalOwnerId).toBe(users.rep.id);
  });

  it("keeps CLOSED terminal ownership unchanged after reassignment", async () => {
    await seedClosePrerequisites();
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.DEAL_CONFIRMED,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [RiskCategory.COMPETITOR_INVOLVED],
      notes: "Confirmed before close",
    });
    await logInteraction({
      byUserId: users.rep.id,
      dealId,
      interactionType: InteractionType.CALL,
      outcome: Outcome.PO_RECEIVED,
      stakeholderType: StakeholderType.DECISION_MAKER,
      risks: [],
      notes: "Closed with PO",
    });
    const stamped = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });

    await assignAccount({ byUserId: users.admin.id, accountId, assigneeId: users.rep2.id });
    const after = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { terminalStage: true, terminalOwnerId: true },
    });

    expect(stamped?.terminalStage).toBe("CLOSED");
    expect(after?.terminalStage).toBe("CLOSED");
    expect(after?.terminalOwnerId).toBe(stamped?.terminalOwnerId);
    expect(after?.terminalOwnerId).toBe(users.rep.id);
  });
});
