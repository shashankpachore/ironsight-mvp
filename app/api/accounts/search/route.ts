import { AccountStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/accounts";
import { buildAccountWhere } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const isPostgresRuntime =
  process.env.TEST_MODE !== "true" && Boolean(process.env.DATABASE_URL?.startsWith("postgresql"));

function nameContainsVariants(q: string): Prisma.AccountWhereInput[] {
  const qLower = q.toLowerCase();
  const variants = new Set<string>([q, qLower, q.toUpperCase()]);
  if (qLower.length > 0) {
    variants.add(qLower[0]!.toUpperCase() + qLower.slice(1));
  }
  return [...variants].map((v) => ({ name: { contains: v } }));
}

function clampLimit(raw: string | null): number {
  if (raw == null || raw === "") return 20;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 20;
  return Math.min(20, Math.max(1, n));
}

function matchTier(row: { name: string; normalized: string }, qLower: string, qNorm: string): 0 | 1 {
  const nameLower = row.name.toLowerCase();
  if (nameLower.startsWith(qLower) || row.normalized.startsWith(qNorm)) return 0;
  return 1;
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const url = new URL(request.url);
  const qRaw = url.searchParams.get("q") ?? "";
  const q = qRaw.trim();
  const limit = clampLimit(url.searchParams.get("limit"));

  if (q.length < 2) {
    return NextResponse.json({ accounts: [] });
  }

  const accessWhere = await buildAccountWhere(user);
  const qLower = q.toLowerCase();
  const qNorm = normalizeCompanyName(q);

  const nameMatchClause: Prisma.AccountWhereInput[] = isPostgresRuntime
    ? [{ name: { contains: q, mode: "insensitive" } }]
    : nameContainsVariants(q);

  const where = {
    AND: [
      accessWhere,
      { status: AccountStatus.APPROVED },
      { assignedToId: user.id },
      {
        OR: [...nameMatchClause, { normalized: { contains: qNorm } }],
      },
    ],
  };

  const take = Math.min(200, limit * 10);
  const rows = await prisma.account.findMany({
    where,
    select: { id: true, name: true, normalized: true },
    take,
  });

  const scored = rows.map((row) => ({
    row,
    tier: matchTier(row, qLower, qNorm),
  }));
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.row.name.localeCompare(b.row.name);
  });

  const accounts = scored.slice(0, limit).map(({ row }) => ({ id: row.id, name: row.name }));
  return NextResponse.json({ accounts });
}
