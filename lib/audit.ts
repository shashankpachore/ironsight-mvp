import { AuditAction, AuditEntityType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type AuditPayload = {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  changedById: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

export async function logAudit(payload: AuditPayload) {
  await prisma.auditLog.create({
    data: {
      entityType: payload.entityType,
      entityId: payload.entityId,
      action: payload.action,
      changedById: payload.changedById,
      before:
        payload.before === undefined
          ? undefined
          : payload.before === null
            ? Prisma.JsonNull
            : payload.before,
      after:
        payload.after === undefined
          ? undefined
          : payload.after === null
            ? Prisma.JsonNull
            : payload.after,
    },
  });
}
