import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { getWorkspace, saveWorkspace, type WorkspaceKind } from "@/server/services/nesting-workspace.service";

const kindOf = (v: unknown): WorkspaceKind | null => (v === "2D" || v === "1D" ? v : null);

export async function GET(req: NextRequest) {
  const { res } = await requirePermission("takeoff.view");
  if (res) return res;
  const projectId = req.nextUrl.searchParams.get("projectId");
  const kind = kindOf(req.nextUrl.searchParams.get("kind"));
  if (!projectId || !kind) return NextResponse.json({ error: "projectId and kind are required" }, { status: 400 });
  const ws = await getWorkspace(projectId, kind);
  return NextResponse.json(ws ? { data: ws.dataJson, updatedAt: ws.updatedAt } : { data: null });
}

export async function PUT(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const body = await req.json().catch(() => null);
  const kind = kindOf(body?.kind);
  if (!body?.projectId || typeof body.projectId !== "string" || !kind || body.data == null) {
    return NextResponse.json({ error: "projectId, kind and data are required" }, { status: 400 });
  }
  const saved = await saveWorkspace(body.projectId, kind, body.data, session!.user.id);
  return NextResponse.json({ ok: true, updatedAt: saved.updatedAt });
}
