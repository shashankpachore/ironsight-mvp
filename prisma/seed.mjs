import {
  PrismaClient,
  UserRole,
  InteractionType,
  Outcome,
  StakeholderType,
  RiskCategory,
} from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRODUCTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../lib/products.json"), "utf8"),
);
const INTERACTION_TYPES = [
  InteractionType.CALL,
  InteractionType.ONLINE_MEETING,
  InteractionType.OFFLINE_MEETING,
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedPick(weightedItems) {
  const total = weightedItems.reduce((sum, item) => sum + item.weight, 0);
  const roll = Math.random() * total;
  let cumulative = 0;
  for (const item of weightedItems) {
    cumulative += item.weight;
    if (roll <= cumulative) return item.value;
  }
  return weightedItems[weightedItems.length - 1].value;
}

function pickProduct() {
  return weightedPick([
    { value: PRODUCTS[0], weight: 35 },
    { value: PRODUCTS[1], weight: 20 },
    { value: PRODUCTS[2], weight: 20 },
    { value: PRODUCTS[3], weight: 15 },
    { value: PRODUCTS[4], weight: 10 },
  ]);
}

function pickStageForProduct(product) {
  if (product === "Geneo Test Prep") {
    return weightedPick([
      { value: "ACCESS", weight: 65 },
      { value: "QUALIFIED", weight: 30 },
      { value: "EVALUATION", weight: 5 },
    ]);
  }
  if (product === "Geneo ONE") {
    return weightedPick([
      { value: "ACCESS", weight: 20 },
      { value: "QUALIFIED", weight: 20 },
      { value: "EVALUATION", weight: 25 },
      { value: "COMMITTED", weight: 20 },
      { value: "CLOSED", weight: 15 },
    ]);
  }
  if (product === "Geneo EDGE") {
    return weightedPick([
      { value: "ACCESS", weight: 10 },
      { value: "QUALIFIED", weight: 15 },
      { value: "EVALUATION", weight: 40 },
      { value: "COMMITTED", weight: 30 },
      { value: "CLOSED", weight: 5 },
    ]);
  }
  if (product === "Geneo Touch") {
    return weightedPick([
      { value: "ACCESS", weight: 10 },
      { value: "QUALIFIED", weight: 20 },
      { value: "EVALUATION", weight: 55 },
      { value: "COMMITTED", weight: 10 },
      { value: "CLOSED", weight: 5 },
    ]);
  }
  return weightedPick([
    { value: "ACCESS", weight: 10 },
    { value: "QUALIFIED", weight: 45 },
    { value: "EVALUATION", weight: 10 },
    { value: "COMMITTED", weight: 30 },
    { value: "CLOSED", weight: 5 },
  ]);
}

function pickDealValue(product) {
  if (product === "Geneo EDGE") return randomInt(100000, 300000);
  if (product === "Geneo IL") return randomInt(200000, 500000);
  if (product === "Geneo ONE" || product === "Geneo Touch") return randomInt(500000, 1000000);
  return randomInt(500000, 2000000);
}

function logSpecForOutcome(outcome) {
  switch (outcome) {
    case Outcome.MET_INFLUENCER:
      return {
        stakeholderType: StakeholderType.INFLUENCER,
        risks: [RiskCategory.NO_ACCESS_TO_DM],
        notes: "Met influencer, DM access pending.",
      };
    case Outcome.MET_DECISION_MAKER:
      return {
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [RiskCategory.BUDGET_NOT_DISCUSSED],
        notes: "Connected with decision maker.",
      };
    case Outcome.BUDGET_DISCUSSED:
      return {
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [RiskCategory.BUDGET_NOT_CONFIRMED],
        notes: "Budget discussion completed.",
      };
    case Outcome.DEMO_DONE:
      return {
        stakeholderType: StakeholderType.INFLUENCER,
        risks: [RiskCategory.LOW_PRODUCT_FIT],
        notes: "Product demo delivered.",
      };
    case Outcome.PRICING_REQUESTED:
      return {
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [RiskCategory.COMPETITOR_INVOLVED],
        notes: "Customer requested pricing details.",
      };
    case Outcome.PROPOSAL_SHARED:
      return {
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [RiskCategory.INTERNAL_ALIGNMENT_MISSING],
        notes: "Proposal shared for internal review.",
      };
    case Outcome.DEAL_CONFIRMED:
      return {
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [RiskCategory.DECISION_DELAYED],
        notes: "Deal verbally confirmed.",
      };
    case Outcome.PO_RECEIVED:
      return {
        stakeholderType: StakeholderType.DECISION_MAKER,
        risks: [RiskCategory.CHAMPION_NOT_STRONG],
        notes: "PO received and verified.",
      };
    default:
      return {
        stakeholderType: StakeholderType.UNKNOWN,
        risks: [RiskCategory.FEATURE_GAP],
        notes: "Follow-up interaction logged.",
      };
  }
}

async function createLogsForStage(dealId, stage) {
  const stageOutcomes = {
    ACCESS: [Outcome.MET_INFLUENCER],
    QUALIFIED: [Outcome.MET_DECISION_MAKER, Outcome.BUDGET_DISCUSSED],
    EVALUATION: [Outcome.DEMO_DONE, Outcome.PRICING_REQUESTED, Outcome.PROPOSAL_SHARED],
    COMMITTED: [Outcome.DEAL_CONFIRMED],
    CLOSED: [Outcome.PO_RECEIVED],
  };
  const orderedStages = ["ACCESS", "QUALIFIED", "EVALUATION", "COMMITTED", "CLOSED"];
  const targetIdx = orderedStages.indexOf(stage);
  for (let i = 0; i <= targetIdx; i += 1) {
    for (const outcome of stageOutcomes[orderedStages[i]]) {
      const spec = logSpecForOutcome(outcome);
      await prisma.interactionLog.create({
        data: {
          dealId,
          interactionType: INTERACTION_TYPES[randomInt(0, INTERACTION_TYPES.length - 1)],
          outcome,
          stakeholderType: spec.stakeholderType,
          notes: spec.notes,
          risks: {
            create: spec.risks.map((category) => ({ category })),
          },
        },
      });
    }
  }
}

async function main() {
  const hashedPassword = await bcrypt.hash("test1234", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@ironsight.local" },
    update: {},
    create: {
      name: "Admin User",
      email: "admin@ironsight.local",
      password: hashedPassword,
      role: UserRole.ADMIN,
    },
  });

  const manager1 = await prisma.user.upsert({
    where: { email: "manager@ironsight.local" },
    update: {},
    create: {
      name: "Manager One",
      email: "manager@ironsight.local",
      password: hashedPassword,
      role: UserRole.MANAGER,
    },
  });

  const manager2 = await prisma.user.upsert({
    where: { email: "manager2@ironsight.local" },
    update: {},
    create: {
      name: "Manager Two",
      email: "manager2@ironsight.local",
      password: hashedPassword,
      role: UserRole.MANAGER,
    },
  });

  const rep = await prisma.user.upsert({
    where: { email: "rep@ironsight.local" },
    update: {},
    create: {
      name: "Rep User",
      email: "rep@ironsight.local",
      password: hashedPassword,
      role: UserRole.REP,
    },
  });

  const extraReps = [];
  for (let i = 1; i <= 10; i += 1) {
    const managerId = i <= 5 ? manager1.id : manager2.id;
    const repUser = await prisma.user.upsert({
      where: { email: `rep${i}@ironsight.local` },
      update: { managerId },
      create: {
        name: `Rep ${i}`,
        email: `rep${i}@ironsight.local`,
        password: hashedPassword,
        role: UserRole.REP,
        managerId,
      },
    });
    extraReps.push(repUser);
  }

  await prisma.user.update({
    where: { id: rep.id },
    data: { managerId: manager1.id },
  });

  await prisma.interactionRisk.deleteMany();
  await prisma.interactionLog.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.account.deleteMany();

  const productCounts = Object.fromEntries(PRODUCTS.map((product) => [product, 0]));
  const stageCounts = {
    ACCESS: 0,
    QUALIFIED: 0,
    EVALUATION: 0,
    COMMITTED: 0,
    CLOSED: 0,
  };
  const splitCounts = {
    repAccounts: 0,
    managerAccounts: 0,
  };
  let totalAccountsCreated = 0;
  let totalDealsCreated = 0;

  async function createSchoolAccountAndDeal({
    schoolIndex,
    createdById,
    ownerId,
  }) {
    const schoolName = `School ${schoolIndex}`;
    const account = await prisma.account.create({
      data: {
        name: schoolName,
        normalized: schoolName.toLowerCase(),
        createdById,
        assignedToId: ownerId,
        status: "APPROVED",
      },
    });
    const product = pickProduct();
    const stage = pickStageForProduct(product);
    const deal = await prisma.deal.create({
      data: {
        name: product,
        companyName: schoolName,
        value: pickDealValue(product),
        ownerId,
        accountId: account.id,
      },
    });
    await createLogsForStage(deal.id, stage);
    productCounts[product] += 1;
    stageCounts[stage] += 1;
    totalDealsCreated += 1;
  }

  let schoolIndex = 1;

  for (const r of extraReps) {
    for (let i = 0; i < 20; i += 1) {
      await createSchoolAccountAndDeal({
        schoolIndex,
        createdById: r.managerId ?? manager1.id,
        ownerId: r.id,
      });
      schoolIndex += 1;
      splitCounts.repAccounts += 1;
      totalAccountsCreated += 1;
    }
  }

  for (let i = 0; i < 10; i += 1) {
    await createSchoolAccountAndDeal({
      schoolIndex,
      createdById: admin.id,
      ownerId: manager1.id,
    });
    schoolIndex += 1;
    splitCounts.managerAccounts += 1;
    totalAccountsCreated += 1;
  }

  for (let i = 0; i < 10; i += 1) {
    await createSchoolAccountAndDeal({
      schoolIndex,
      createdById: admin.id,
      ownerId: manager2.id,
    });
    schoolIndex += 1;
    splitCounts.managerAccounts += 1;
    totalAccountsCreated += 1;
  }

  console.log("Seed complete: 14 users (2 managers + 10 reps + admin + base rep).");
  console.log(`Total school accounts created: ${totalAccountsCreated}`);
  console.log("School split:", splitCounts);
  console.log(`Total deals created: ${totalDealsCreated}`);
  console.log("Product distribution:", productCounts);
  console.log("Stage distribution:", stageCounts);
  console.log(`ADMIN userId: ${admin.id}`);
  console.log(`MANAGER1 userId: ${manager1.id}`);
  console.log(`MANAGER2 userId: ${manager2.id}`);
  console.log(`REP userId: ${rep.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
