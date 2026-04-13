import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  if (!ids) return {};
  return { assignedToId: { in: ids } };
}

export async function buildDealWhere(user: AccessUser): Promise<Prisma.DealWhereInput> {
  assertValidAccessUser(user);
  const ids = await getAccessibleUserIds(user);
  if (!ids) return {};
  return { account: { assignedToId: { in: ids } } };
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

  const where = await buildDealWhere(user);
  const deal = await prisma.deal.findFirst({
    where: {
      id: dealId,
      ...where,
    },
  });

  if (!deal) {
    throw new Error("ACCESS_DENIED");
  }

  return deal;
}
