import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { applyNestSync, getNestSyncStatus } from "@/server/services/nest-sync.service";

// GET ?projectId= — what would change (nothing is written).
export async function GET(req: NextRequest) {
  const { res } = await requirePermission("takeoff.view");
  if (res) return res;
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json(await getNestSyncStatus(projectId));
}

// POST { projectId } — applies the nest-side quantity changes to the BOQ and returns the remaining differences.
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json(await applyNestSync(projectId, session!.user.id));
}
