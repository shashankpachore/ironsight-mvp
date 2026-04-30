import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { requireRole } from "@/lib/authz";
import { GET as pipelineGET } from "../route";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  const authz = requireRole(user, [UserRole.ADMIN]);
  if (authz) return authz;

  const url = new URL(request.url);
  url.pathname = "/api/pipeline";
  url.searchParams.set("includeOutcomes", "1");
  const pipelineRes = await pipelineGET(new Request(url, { headers: request.headers }));
  if (!pipelineRes.ok) return pipelineRes;

  const body = (await pipelineRes.json()) as { managerBreakdown?: unknown[] };
  return NextResponse.json(body.managerBreakdown ?? []);
}
