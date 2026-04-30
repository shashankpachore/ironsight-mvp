import { AccountStatus } from "@prisma/client";

export function validateDealCreationAccess(params: {
  account: { status: AccountStatus; assignedToId: string | null };
  currentUserId: string;
}) {
  if (params.account.status !== AccountStatus.APPROVED) {
    return "account must be approved";
  }
  if (!params.account.assignedToId) {
    return "account must be assigned before creating deals";
  }
  if (params.account.assignedToId !== params.currentUserId) {
    return "only assigned user can create deal";
  }
  return null;
}

export function validateInteractionLogAccess(params: {
  accountAssignedToId: string | null;
  currentUserId: string;
  ownerId?: string | null;
  coOwnerId?: string | null;
}) {
  if (!params.accountAssignedToId) {
    return "account must be assigned before logging interactions";
  }
  if (
    params.accountAssignedToId !== params.currentUserId &&
    params.ownerId !== params.currentUserId &&
    params.coOwnerId !== params.currentUserId
  ) {
    return "only assigned user can log interactions";
  }
  return null;
}
