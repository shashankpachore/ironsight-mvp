import { PrismaClient as ProdPrismaClient } from "@prisma/client";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { PrismaClient as DevPrismaClient } from "@prisma/dev-client";
import { PrismaClient as TestPrismaClient } from "@prisma/test-client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientType };

function createPrismaClient(): PrismaClientType {
  if (process.env.TEST_MODE === "true") {
    return new TestPrismaClient({ log: ["error"] }) as unknown as PrismaClientType;
  }
  if (process.env.NODE_ENV === "development") {
    return new DevPrismaClient({ log: ["error"] }) as unknown as PrismaClientType;
  }
  return new ProdPrismaClient({ log: ["error"] });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
