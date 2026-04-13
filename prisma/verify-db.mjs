import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userCount = await prisma.user.count();
  const accountCount = await prisma.account.count();
  const dealCount = await prisma.deal.count();
  const logCount = await prisma.interactionLog.count();
  const auditCount = await prisma.auditLog.count();
  console.log(JSON.stringify({ userCount, accountCount, dealCount, logCount, auditCount }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
