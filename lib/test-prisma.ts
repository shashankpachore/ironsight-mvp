import { PrismaClient } from "@prisma/test-client";

const globalForTestPrisma = globalThis as unknown as { testPrisma?: PrismaClient };

export const prismaTest =
  globalForTestPrisma.testPrisma ??
  new PrismaClient({
    log: ["error"],
  });

export const prisma = prismaTest;

if (process.env.NODE_ENV !== "production") {
  globalForTestPrisma.testPrisma = prismaTest;
}
