import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const ACTIVE_ONLY = { deletedAt: null } as const;

type AccessUser = {
  id: string;
  role: UserRole;
};

function assertValidAccessUser(user: AccessUser | null | undefined): asserts user is AccessUser {
  if (!user || !user.role) {
    throw new Error("Invalid user in access control");
  }
}

function shouldLogAccessScope() {
  return process.env.NODE_ENV !== "production" || process.env.TEST_MODE === "true";
}

export async function getAccessibleUserIds(user: AccessUser): Promise<string[] | null> {
  assertValidAccessUser(user);

  let ids: string[] | null;
  if (user.role === UserRole.ADMIN) {
    ids = null;
  } else if (user.role === UserRole.MANAGER) {
    const reps = await prisma.user.findMany({
      where: { managerId: user.id, role: UserRole.REP },
      select: { id: true },
    });
    ids = [user.id, ...reps.map((rep) => rep.id)];
  } else {
    ids = [user.id];
  }

  if (shouldLogAccessScope()) {
    console.log("ACCESS_SCOPE", {
      userId: user.id,
      role: user.role,
      ids,
    });
  }

  return ids;
}

export async function buildAccountWhere(user: AccessUser): Promise<Prisma.AccountWhereInput> {
  assertValidAccessUser(user);
  const ids = await getAccessibleUserIds(user);
  if (!ids) return { ...ACTIVE_ONLY };
  return { assignedToId: { in: ids }, ...ACTIVE_ONLY };
}

export async function buildDealWhere(user: AccessUser): Promise<Prisma.DealWhereInput> {
  assertValidAccessUser(user);
  const ids = await getAccessibleUserIds(user);
  const filter = ids
    ? {
        OR: [
          { account: { assignedToId: { in: ids } } },
          { ownerId: { in: ids } },
          { coOwnerId: { in: ids } },
          { ownerId: user.id },
          { coOwnerId: user.id },
        ],
      }
    : {};
  return { ...filter, ...ACTIVE_ONLY, account: { ...ACTIVE_ONLY } };
}

export async function canAccessAssignedToId(
  user: AccessUser,
  assignedToId: string | null,
): Promise<boolean> {
  assertValidAccessUser(user);
  if (!assignedToId) return user.role === UserRole.ADMIN;

  const ids = await getAccessibleUserIds(user);
  if (!ids) return true;
  return ids.includes(assignedToId);
}

export async function assertDealAccess(user: AccessUser, dealId: string) {
  assertValidAccessUser(user);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { account: { select: { deletedAt: true } } },
  });

  if (!deal) {
    throw new Error("NOT_FOUND");
  }

  if (deal.deletedAt || (deal.account && deal.account.deletedAt)) {
    throw new Error("DELETED");
  }

  const where = await buildDealWhere(user);
  const accessibleDeal = await prisma.deal.findFirst({
    where: {
      id: dealId,
      ...where,
    },
  });

  if (!accessibleDeal) {
    throw new Error("ACCESS_DENIED");
  }

  return deal;
}

export async function assertAccountAccess(user: AccessUser, accountId: string) {
  assertValidAccessUser(user);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error("NOT_FOUND");
  }

  if (account.deletedAt) {
    throw new Error("DELETED");
  }

  const where = await buildAccountWhere(user);
  const accessibleAccount = await prisma.account.findFirst({
    where: {
      id: accountId,
      ...where,
    },
  });

  if (!accessibleAccount) {
    throw new Error("ACCESS_DENIED");
  }

  return account;
}
