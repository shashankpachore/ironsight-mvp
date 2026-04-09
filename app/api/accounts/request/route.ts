import { NextResponse } from "next/server";
import { AuditAction, AuditEntityType } from "@prisma/client";
import { normalizeCompanyName } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const body = (await request.json()) as { name?: string };
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const normalized = normalizeCompanyName(body.name);
  const existing = await prisma.account.findUnique({ where: { normalized } });
  if (existing) {
    return NextResponse.json(
      { error: "account already exists", existingAccount: existing },
      { status: 409 },
    );
  }

  const account = await prisma.account.create({
    data: {
      name: body.name.trim(),
      normalized,
      createdById: user.id,
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
