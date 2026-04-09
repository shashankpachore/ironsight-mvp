import { AccountStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  validateDealCreationAccess,
  validateInteractionLogAccess,
} from "../lib/account-access";

describe("strict assignee-only ownership for deal creation", () => {
  it("allows assigned user to create deal", () => {
    const error = validateDealCreationAccess({
      account: { status: AccountStatus.APPROVED, assignedToId: "user-1" },
      currentUserId: "user-1",
    });
    expect(error).toBeNull();
  });

  it("blocks non-assigned user (admin/manager/rep all same rule)", () => {
    const error = validateDealCreationAccess({
      account: { status: AccountStatus.APPROVED, assignedToId: "rep-1" },
      currentUserId: "manager-1",
    });
    expect(error).toBe("only assigned user can create deal");
  });

  it("blocks unassigned account for deal creation", () => {
    const error = validateDealCreationAccess({
      account: { status: AccountStatus.APPROVED, assignedToId: null },
      currentUserId: "user-1",
    });
    expect(error).toBe("account must be assigned before creating deals");
  });

  it("blocks unapproved account for deal creation", () => {
    const error = validateDealCreationAccess({
      account: { status: AccountStatus.PENDING, assignedToId: "user-1" },
      currentUserId: "user-1",
    });
    expect(error).toBe("account must be approved");
  });
});

describe("strict assignee-only ownership for interaction logging", () => {
  it("allows assigned user to log interaction", () => {
    const error = validateInteractionLogAccess({
      accountAssignedToId: "user-1",
      currentUserId: "user-1",
    });
    expect(error).toBeNull();
  });

  it("blocks non-assigned user from logging", () => {
    const error = validateInteractionLogAccess({
      accountAssignedToId: "rep-1",
      currentUserId: "admin-1",
    });
    expect(error).toBe("only assigned user can log interactions");
  });

  it("blocks logging when account has no assignee", () => {
    const error = validateInteractionLogAccess({
      accountAssignedToId: null,
      currentUserId: "user-1",
    });
    expect(error).toBe("account must be assigned before logging interactions");
  });
});
