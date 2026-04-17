const isPostgres = process.env.DATABASE_URL?.startsWith("postgresql")

let PrismaClient

if (process.env.TEST_MODE === "true") {
  PrismaClient = require("@prisma/test-client").PrismaClient
} else if (isPostgres) {
  PrismaClient = require("@prisma/client").PrismaClient
} else {
  PrismaClient = require("@prisma/dev-client").PrismaClient
}

export const prisma = new PrismaClient()
