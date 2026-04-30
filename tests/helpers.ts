import { AccountStatus, InteractionType, Outcome, Prisma, RiskCategory, StakeholderType, UserRole } from "@prisma/client";
import { prismaTest as prisma } from "../lib/test-prisma";
import { PRODUCT_OPTIONS } from "../lib/products";
import { POST as requestAccountRoute } from "../app/api/accounts/request/route";
import { POST as approveAccountRoute } from "../app/api/accounts/[id]/approve/route";
import { POST as assignAccountRoute } from "../app/api/accounts/[id]/assign/route";
import { POST as createDealRoute } from "../app/api/deals/route";
import { POST as logInteractionRoute } from "../app/api/logs/route";
import { defaultNextStepRequestFields } from "../lib/next-step";

export type SeededUsers = {
  admin: { id: string; email: string; role: UserRole };
  manager: { id: string; email: string; role: UserRole };
  manager2: { id: string; email: string; role: UserRole };
  rep: { id: string; email: string; role: UserRole };
  rep2: { id: string; email: string; role: UserRole };
};

export async function resetDbAndSeedUsers(): Promise<SeededUsers> {
  const url = process.env.DATABASE_URL ?? "";

  const seed = async (tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">) => {
    const admin = await tx.user.create({
      data: { name: "Admin", email: "admin@ironsight.local", password: "test1234", role: UserRole.ADMIN },
    });
    const manager = await tx.user.create({
      data: { name: "Manager", email: "manager@ironsight.local", password: "test1234", role: UserRole.MANAGER },
    });
    const manager2 = await tx.user.create({
      data: { name: "Manager Two", email: "manager2@ironsight.local", password: "test1234", role: UserRole.MANAGER },
    });
    const rep = await tx.user.create({
      data: {
        name: "Rep",
        email: "rep@ironsight.local",
        password: "test1234",
        role: UserRole.REP,
        managerId: manager.id,
      },
    });
    const rep2 = await tx.user.create({
      data: {
        name: "Rep Two",
        email: "rep2@ironsight.local",
        password: "test1234",
        role: UserRole.REP,
        managerId: manager2.id,
      },
    });
    return {
      admin: { id: admin.id, email: admin.email, role: admin.role },
      manager: { id: manager.id, email: manager.email, role: manager.role },
      manager2: { id: manager2.id, email: manager2.email, role: manager2.role },
      rep: { id: rep.id, email: rep.email, role: rep.role },
      rep2: { id: rep2.id, email: rep2.email, role: rep2.role },
    };
  };

  // Run wipe + seed in one transaction so pooled DBs (e.g. Neon) do not read stale rows on another connection.
  if (url.startsWith("postgres")) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `TRUNCATE TABLE "InteractionLogParticipant", "InteractionRisk", "InteractionLog", "PipelineSnapshot", "Deal", "Account", "AuditLog", "User" RESTART IDENTITY CASCADE;`,
      );
      return seed(tx);
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.interactionRisk.deleteMany();
    await tx.interactionLogParticipant.deleteMany();
    await tx.interactionLog.deleteMany();
    await tx.pipelineSnapshot.deleteMany();
    await tx.deal.deleteMany();
    await tx.account.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.user.updateMany({ data: { managerId: null } });
    await tx.user.deleteMany();
    return seed(tx);
  });
}

export function makeRequest(url: string, init?: { method?: string; body?: unknown; userId?: string }) {
  const headers = new Headers();
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  if (init?.userId) headers.set("x-user-id", init.userId);
  return new Request(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function createAccount(params: {
  byUserId: string;
  name: string;
  type?: "SCHOOL" | "PARTNER";
  district?: string;
  state?: string;
}) {
  const res = await requestAccountRoute(
    makeRequest("http://localhost/api/accounts/request", {
      method: "POST",
      userId: params.byUserId,
      body: {
        name: params.name,
        type: params.type ?? "SCHOOL",
        district: params.district ?? "Mumbai",
        state: params.state ?? "Maharashtra",
      },
    }),
  );
  return res;
}

export async function approveAccount(params: { byUserId: string; accountId: string }) {
  return approveAccountRoute(
    makeRequest(`http://localhost/api/accounts/${params.accountId}/approve`, {
      method: "POST",
      userId: params.byUserId,
      body: {},
    }),
    { params: Promise.resolve({ id: params.accountId }) },
  );
}

export async function assignAccount(params: { byUserId: string; accountId: string; assigneeId: string }) {
  return assignAccountRoute(
    makeRequest(`http://localhost/api/accounts/${params.accountId}/assign`, {
      method: "POST",
      userId: params.byUserId,
      body: { userId: params.assigneeId },
    }),
    { params: Promise.resolve({ id: params.accountId }) },
  );
}

export async function createDeal(params: {
  byUserId: string;
  name: string;
  value: number;
  accountId: string;
  coOwnerId?: string | null;
}) {
  const product = PRODUCT_OPTIONS.includes(params.name) ? params.name : PRODUCT_OPTIONS[0];
  return createDealRoute(
    makeRequest("http://localhost/api/deals", {
      method: "POST",
      userId: params.byUserId,
      body: {
        name: product,
        companyName: "IGNORED",
        value: params.value,
        accountId: params.accountId,
        ...(params.coOwnerId !== undefined ? { coOwnerId: params.coOwnerId } : {}),
      },
    }),
  );
}

function defaultRisksForOutcome(outcome: Outcome): RiskCategory[] {
  if (outcome === Outcome.PO_RECEIVED) return [];
  if (outcome === Outcome.DEAL_CONFIRMED) return [RiskCategory.COMPETITOR_INVOLVED];
  if (outcome === Outcome.LOST_TO_COMPETITOR) return [RiskCategory.COMPETITOR_PREFERRED];
  if (outcome === Outcome.DEAL_DROPPED) return [RiskCategory.CHAMPION_NOT_STRONG];
  if (outcome === Outcome.BUDGET_NOT_AVAILABLE) return [RiskCategory.BUDGET_INSUFFICIENT];
  if (
    outcome === Outcome.DEMO_DONE ||
    outcome === Outcome.PRICING_REQUESTED ||
    outcome === Outcome.PROPOSAL_SHARED ||
    outcome === Outcome.BUDGET_CONFIRMED ||
    outcome === Outcome.NEGOTIATION_STARTED
  ) {
    return [RiskCategory.BUDGET_NOT_CONFIRMED];
  }
  return [RiskCategory.NO_ACCESS_TO_DM];
}

export async function logInteraction(params: {
  byUserId: string;
  dealId: string;
  interactionType?: InteractionType;
  outcome?: Outcome;
  stakeholderType?: StakeholderType;
  risks?: RiskCategory[];
  notes?: string;
  participants?: string[];
}) {
  const outcome = params.outcome ?? Outcome.FOLLOW_UP_DONE;
  return logInteractionRoute(
    makeRequest("http://localhost/api/logs", {
      method: "POST",
      userId: params.byUserId,
      body: {
        dealId: params.dealId,
        interactionType: params.interactionType ?? InteractionType.CALL,
        outcome,
        stakeholderType: params.stakeholderType ?? StakeholderType.UNKNOWN,
        risks: params.risks ?? defaultRisksForOutcome(outcome),
        notes: params.notes ?? "test",
        ...(params.participants !== undefined ? { participants: params.participants } : {}),
        ...defaultNextStepRequestFields(outcome),
      },
    }),
  );
}

export async function bootstrapApprovedAssignedAccount(params: {
  creatorUserId: string;
  approverUserId: string;
  assignerUserId: string;
  assigneeUserId: string;
  name: string;
}) {
  const createRes = await createAccount({ byUserId: params.creatorUserId, name: params.name });
  const account = await json<{ id: string }>(createRes);
  await approveAccount({ byUserId: params.approverUserId, accountId: account.id });
  await assignAccount({
    byUserId: params.assignerUserId,
    accountId: account.id,
    assigneeId: params.assigneeUserId,
  });
  return account.id;
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function setDealLastActivity(dealId: string, daysAgo: number) {
  await prisma.deal.update({
    where: { id: dealId },
    data: { lastActivityAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) },
  });
}

export async function getAccount(accountId: string) {
  return prisma.account.findUnique({ where: { id: accountId } });
}

export async function getDeal(dealId: string) {
  return prisma.deal.findUnique({ where: { id: dealId }, include: { account: true } });
}

export async function createAccountDirect(data: Prisma.AccountUncheckedCreateInput & { status?: AccountStatus }) {
  return prisma.account.create({ data });
}
