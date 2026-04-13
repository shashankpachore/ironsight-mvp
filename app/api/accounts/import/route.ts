import { AccountStatus, AccountType, AuditAction, AuditEntityType } from "@prisma/client";
import { NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type ParsedRow = {
  rowNumber: number;
  name: string;
  normalized: string;
  state: string;
  district: string;
  type: AccountType;
  duplicateInFile: boolean;
  duplicateInDb: boolean;
  errors: string[];
};

function parseCsv(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return { headers: [] as string[], rows: [] as string[][] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((c) => c.trim()));
  return { headers, rows };
}

function mapRows(headers: string[], rows: string[][]): ParsedRow[] {
  const schoolIdx = headers.findIndex((h) => h.toLowerCase() === "school name");
  const partnerIdx = headers.findIndex((h) => h.toLowerCase() === "partner name");
  const stateIdx = headers.findIndex((h) => h.toLowerCase() === "state");
  const districtIdx = headers.findIndex((h) => h.toLowerCase() === "district");

  const type =
    schoolIdx >= 0 ? AccountType.SCHOOL : partnerIdx >= 0 ? AccountType.PARTNER : null;
  const nameIdx = schoolIdx >= 0 ? schoolIdx : partnerIdx;

  return rows.map((row, index) => {
    const errors: string[] = [];
    const name = nameIdx >= 0 ? (row[nameIdx] ?? "").trim() : "";
    const state = stateIdx >= 0 ? (row[stateIdx] ?? "").trim() : "";
    const district = districtIdx >= 0 ? (row[districtIdx] ?? "").trim() : "";

    if (!type) errors.push("missing School Name or Partner Name column");
    if (!name) errors.push("name is required");
    if (!state) errors.push("state is required");
    if (!district) errors.push("district is required");

    return {
      rowNumber: index + 2,
      name,
      normalized: normalizeCompanyName(name || ""),
      state,
      district,
      type: type ?? AccountType.SCHOOL,
      duplicateInFile: false,
      duplicateInDb: false,
      errors,
    };
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 401 });

  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "preview").toLowerCase();
  if (mode !== "preview" && mode !== "confirm") {
    return NextResponse.json({ error: "mode must be preview or confirm" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const content = await file.text();
  const { headers, rows } = parseCsv(content);
  const parsed = mapRows(headers, rows);

  const seen = new Set<string>();
  for (const row of parsed) {
    if (!row.normalized) continue;
    if (seen.has(row.normalized)) row.duplicateInFile = true;
    seen.add(row.normalized);
  }

  const normalizeds = parsed
    .filter((row) => row.normalized.length > 0)
    .map((row) => row.normalized);
  const existing = normalizeds.length
    ? await prisma.account.findMany({
      where: { normalized: { in: normalizeds } },
      select: { normalized: true },
    })
    : [];
  const existingSet = new Set(existing.map((row) => row.normalized));
  parsed.forEach((row) => {
    row.duplicateInDb = existingSet.has(row.normalized);
  });

  const validRows = parsed.filter(
    (row) => row.errors.length === 0 && !row.duplicateInDb && !row.duplicateInFile,
  );

  if (mode === "preview") {
    return NextResponse.json({
      mode: "preview",
      totalRows: parsed.length,
      validRows: validRows.length,
      rows: parsed,
    });
  }

  if (validRows.length === 0) {
    return NextResponse.json(
      { error: "no valid rows to import", totalRows: parsed.length, rows: parsed },
      { status: 400 },
    );
  }

  const created = await prisma.$transaction(
    validRows.map((row) =>
      prisma.account.create({
        data: {
          name: row.name,
          normalized: row.normalized,
          type: row.type,
          state: row.state,
          district: row.district,
          status: AccountStatus.PENDING,
          createdById: user.id,
          requestedById: user.id,
          assignedToId: user.id,
        },
      }),
    ),
  );

  await Promise.all(
    created.map((account) =>
      logAudit({
        entityType: AuditEntityType.ACCOUNT,
        entityId: account.id,
        action: AuditAction.CREATE,
        changedById: user!.id,
        before: null,
        after: account,
      }),
    ),
  );

  return NextResponse.json({
    mode: "confirm",
    imported: created.length,
    skipped: parsed.length - created.length,
    rows: parsed,
  });
}
