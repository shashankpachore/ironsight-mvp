import { PrismaClient } from "@prisma/client";

const globalForTestPrisma = globalThis as unknown as { testPrisma?: PrismaClient };

export const prisma =
  globalForTestPrisma.testPrisma ??
  new PrismaClient({
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForTestPrisma.testPrisma = prisma;
}
