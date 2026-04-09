// SECURITY CRITICAL:
// Do not modify role access without updating tests
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { requireRole } from "@/lib/authz";
import { getDealStage, getMissingSignals } from "@/lib/deals";
import { prisma } from "@/lib/prisma";

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authzError = requireRole(user, [UserRole.ADMIN, UserRole.MANAGER]);
  if (authzError) return authzError;

  const deals = await prisma.deal.findMany({
    where: {},
    include: {
      account: {
        include: { assignedTo: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
    deals.map(async (deal) => {
      const stage = await getDealStage(deal.id);
      const missingSignals = await getMissingSignals(deal.id);
      return [
        escapeCsv(deal.account.name),
        escapeCsv(deal.account.assignedTo?.email ?? ""),
        String(deal.value),
        escapeCsv(stage),
        escapeCsv(deal.lastActivityAt.toISOString()),
        escapeCsv(missingSignals.join(" | ")),
      ].join(",");
    }),
  );

  const csv = [
    "Account Name,Assigned Rep,Deal Value,Stage,Last Activity Date,Missing Signals",
    ...rows,
  ].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ironsight-export.csv"',
    },
  });
}
