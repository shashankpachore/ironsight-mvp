import { generateMonthlySnapshot } from "../lib/pipeline/monthly-snapshot";
import { prisma } from "../lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const month = args[0];

  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    console.error("Usage: npx tsx scripts/backfill-snapshot.ts YYYY-MM");
    process.exit(1);
  }

  console.log(`🚀 Starting backfill for ${month}...`);

  try {
    const result = await generateMonthlySnapshot(month, prisma);
    console.log(`✅ Success! Inserted ${result.insertedCount} snapshot rows for ${month}.`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`);
    } else {
      console.error("❌ An unknown error occurred");
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
