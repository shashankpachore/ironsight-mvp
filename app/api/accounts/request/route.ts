import { AccountStatus, AccountType, AuditAction, AuditEntityType } from "@prisma/client";
import { NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { validateStateDistrict } from "@/lib/geo/india-states-districts";
import { prisma } from "@/lib/prisma";

function parseAccountType(raw: unknown): AccountType | null {
  if (raw === AccountType.SCHOOL || raw === "SCHOOL") return AccountType.SCHOOL;
  if (raw === AccountType.PARTNER || raw === "PARTNER") return AccountType.PARTNER;
  return null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const body = (await request.json()) as {
    type?: unknown;
    name?: unknown;
    district?: unknown;
    state?: unknown;
  };

  const type = parseAccountType(body?.type);
  if (!type) {
    return NextResponse.json({ error: "type is required (SCHOOL or PARTNER)" }, { status: 400 });
  }

  if (typeof body?.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (typeof body?.district !== "string" || !body.district.trim()) {
    return NextResponse.json({ error: "district is required" }, { status: 400 });
  }

  if (typeof body?.state !== "string" || !body.state.trim()) {
    return NextResponse.json({ error: "state is required" }, { status: 400 });
  }

  const geo = validateStateDistrict(body.state, body.district);
  if (!geo.ok) {
    return NextResponse.json({ error: geo.error }, { status: 400 });
  }

  const name = body.name.trim();
  const normalized = normalizeCompanyName(name);
  const existing = await prisma.account.findUnique({ where: { normalized } });
  if (existing) {
    return NextResponse.json(
      { error: "account already exists", existingAccount: existing },
      { status: 409 },
    );
  }

  const account = await prisma.account.create({
    data: {
      name,
      normalized,
      type,
      state: geo.state,
      district: geo.district,
      status: AccountStatus.PENDING,
      createdById: user.id,
      requestedById: user.id,
    },
  });

  await logAudit({
    entityType: AuditEntityType.ACCOUNT,
    entityId: account.id,
    action: AuditAction.CREATE,
    changedById: user!.id,
    before: null,
    after: account,
  });

  return NextResponse.json(account, { status: 201 });
}
