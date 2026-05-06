import { AccountStatus, AccountType, AuditAction, AuditEntityType } from "@prisma/client";
import type { Account } from "@prisma/client";
import { NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { validateStateDistrict } from "@/lib/geo/india-states-districts";
import { suggestStateDistrict, type GeoConfidence, type GeoImportStatus } from "@/lib/geo/match";
import { prisma } from "@/lib/prisma";

type ParsedRow = {
  row: number;
  rowNumber: number;
  name: string;
  normalized: string;
  state: string;
  district: string;
  input: { state: string; district: string };
  status: GeoImportStatus;
  confidence?: GeoConfidence;
  corrected?: { state: string; district: string };
  suggestions?: string[];
  stateSuggestions?: string[];
  districtSuggestions?: string[];
  type: AccountType;
  duplicateInFile: boolean;
  duplicateInDb: boolean;
  errors: string[];
};

type ManualFix = {
  state?: unknown;
  district?: unknown;
};

type ImportDecision = {
  approvedCorrections: Set<number>;
  manualFixes: Record<number, { state: string; district: string }>;
};

function rowErrors(row: ParsedRow): string[] {
  const errors = [...row.errors];
  if (row.duplicateInFile) errors.push("Duplicate row in file");
  if (row.duplicateInDb) errors.push("Account already exists");
  return errors;
}

function failedRows(rows: ParsedRow[]) {
  return rows
    .map((row) => ({ row: row.rowNumber, errors: rowErrors(row) }))
    .filter((row) => row.errors.length > 0)
    .map((row) => ({ row: row.row, error: row.errors.join("; ") }));
}

function parseJsonFormValue(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseImportDecision(formData: FormData): ImportDecision {
  const rawApproved = parseJsonFormValue(formData.get("approvedCorrections"));
  const approvedCorrections = new Set<number>(
    Array.isArray(rawApproved)
      ? rawApproved.filter((row): row is number => Number.isInteger(row))
      : [],
  );

  const rawManualFixes = parseJsonFormValue(formData.get("manualFixes"));
  const manualFixes: ImportDecision["manualFixes"] = {};
  if (rawManualFixes && typeof rawManualFixes === "object" && !Array.isArray(rawManualFixes)) {
    for (const [row, fix] of Object.entries(rawManualFixes as Record<string, ManualFix>)) {
      const rowNumber = Number(row);
      if (!Number.isInteger(rowNumber)) continue;
      if (typeof fix.state !== "string" || typeof fix.district !== "string") continue;
      manualFixes[rowNumber] = { state: fix.state, district: fix.district };
    }
  }

  return { approvedCorrections, manualFixes };
}

function parseCsv(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const firstLine = lines[0];
  if (lines.length < 2 || !firstLine) {
    return { headers: [] as string[], rows: [] as string[][] };
  }
  const headers = firstLine.split(",").map((h) => h.trim());
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
    let state = stateIdx >= 0 ? (row[stateIdx] ?? "").trim() : "";
    let district = districtIdx >= 0 ? (row[districtIdx] ?? "").trim() : "";
    const input = { state, district };
    let status: GeoImportStatus = "rejected";
    let confidence: GeoConfidence | undefined;
    let corrected: ParsedRow["corrected"];
    let suggestions: string[] | undefined;
    let stateSuggestions: string[] | undefined;
    let districtSuggestions: string[] | undefined;

    if (!type) errors.push("missing School Name or Partner Name column");
    if (!name) errors.push("name is required");
    if (!state) errors.push("state is required");
    if (!district) errors.push("district is required");
    if (state && district) {
      const geo = suggestStateDistrict(state, district);
      status = geo.status;
      confidence = geo.confidence;
      corrected = geo.corrected;
      suggestions = geo.suggestions;
      stateSuggestions = geo.stateSuggestions;
      districtSuggestions = geo.districtSuggestions;
      if ((geo.status === "accepted" || geo.status === "corrected") && geo.corrected) {
        state = geo.corrected.state;
        district = geo.corrected.district;
      } else {
        if (geo.error) errors.push(geo.error);
      }
    }

    return {
      row: index + 2,
      rowNumber: index + 2,
      name,
      normalized: normalizeCompanyName(name || ""),
      state,
      district,
      input,
      status,
      confidence,
      corrected,
      suggestions,
      stateSuggestions,
      districtSuggestions,
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
  const decisions = parseImportDecision(formData);
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
  const existing: Array<{ normalized: string }> = normalizeds.length
    ? await prisma.account.findMany({
      where: { normalized: { in: normalizeds } },
      select: { normalized: true },
    })
    : [];
  const existingSet = new Set(existing.map((row) => row.normalized));
  parsed.forEach((row) => {
    row.duplicateInDb = existingSet.has(row.normalized);
  });

  for (const row of parsed) {
    if (row.duplicateInDb || row.duplicateInFile) row.status = "rejected";
    const manualFix = decisions.manualFixes[row.rowNumber];
    if (!manualFix) continue;

    const geo = validateStateDistrict(manualFix.state, manualFix.district);
    if (!geo.ok) {
      row.errors = [geo.error];
      row.status = "rejected";
      continue;
    }

    row.state = geo.state;
    row.district = geo.district;
    row.corrected = { state: geo.state, district: geo.district };
    row.status = "corrected";
    row.confidence = "high";
    row.errors = [];
  }

  if (mode === "confirm") {
    for (const row of parsed) {
      const hasManualFix = !!decisions.manualFixes[row.rowNumber];
      const hasApprovedCorrection = decisions.approvedCorrections.has(row.rowNumber);
      if (row.status === "corrected" && !hasManualFix && !hasApprovedCorrection && row.errors.length === 0) {
        row.errors.push("Correction not approved");
      }
      if (row.status === "needs_review" && !hasManualFix && row.errors.length === 0) {
        row.errors.push("Needs review");
      }
    }
  }

  const validRows = parsed.filter((row) => {
    if (row.errors.length > 0 || row.duplicateInDb || row.duplicateInFile) return false;
    if (row.status === "accepted") return true;
    if (row.status === "corrected") return decisions.approvedCorrections.has(row.rowNumber) || !!decisions.manualFixes[row.rowNumber];
    return false;
  });
  const failures = failedRows(parsed);
  const summary = {
    accepted: parsed.filter((row) => row.status === "accepted" && row.errors.length === 0).length,
    corrected: parsed.filter((row) => row.status === "corrected" && row.errors.length === 0).length,
    needsReview: parsed.filter((row) => row.status === "needs_review").length,
    rejected: parsed.filter((row) => row.status === "rejected" || row.errors.length > 0 || row.duplicateInDb || row.duplicateInFile).length,
  };

  if (mode === "preview") {
    return NextResponse.json({
      mode: "preview",
      totalRows: parsed.length,
      validRows: validRows.length,
      successCount: validRows.length,
      summary,
      failedRows: failures,
      rows: parsed,
    });
  }

  if (validRows.length === 0) {
    return NextResponse.json({
      mode: "confirm",
      imported: 0,
      skipped: parsed.length,
      successCount: 0,
      summary,
      failedRows: failures,
      rows: parsed,
    });
  }

  const created: Account[] = await prisma.$transaction(
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
    created.map((account: Account) =>
      logAudit({
        entityType: AuditEntityType.ACCOUNT,
        entityId: account.id,
        action: AuditAction.CREATE,
        changedById: user.id,
        before: null,
        after: account,
      }),
    ),
  );

  return NextResponse.json({
    mode: "confirm",
    imported: created.length,
    skipped: parsed.length - created.length,
    successCount: created.length,
    summary,
    failedRows: failures,
    rows: parsed,
  });
}
