import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { getWorkspace, saveWorkspace, type WorkspaceKind } from "@/server/services/nesting-workspace.service";
import { getHistoryData, saveHistoryData } from "@/server/services/nesting-history.service";

const kindOf = (v: unknown): WorkspaceKind | null => (v === "2D" || v === "1D" ? v : null);

// `projectId` = the workspace of a project; `historyId` = an entry of the signed-in user's nesting history.
export async function GET(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.view");
  if (res) return res;
  const projectId = req.nextUrl.searchParams.get("projectId");
  const historyId = req.nextUrl.searchParams.get("historyId");
  const kind = kindOf(req.nextUrl.searchParams.get("kind"));
  if ((!projectId && !historyId) || !kind) return NextResponse.json({ error: "projectId (or historyId) and kind are required" }, { status: 400 });
  if (historyId) {
    const h = await getHistoryData(session!.user.id, historyId, kind);
    if (h === undefined) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(h.data ? { data: h.data, updatedAt: h.updatedAt } : { data: null });
  }
  const ws = await getWorkspace(projectId!, kind);
  return NextResponse.json(ws ? { data: ws.dataJson, updatedAt: ws.updatedAt } : { data: null });
}

export async function PUT(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const body = await req.json().catch(() => null);
  const kind = kindOf(body?.kind);
  const projectId = typeof body?.projectId === "string" && body.projectId ? body.projectId : null;
  const historyId = typeof body?.historyId === "string" && body.historyId ? body.historyId : null;
  if ((!projectId && !historyId) || !kind || body?.data == null) {
    return NextResponse.json({ error: "projectId (or historyId), kind and data are required" }, { status: 400 });
  }
  if (historyId) {
    if (!(await saveHistoryData(session!.user.id, historyId, kind, body.data))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, updatedAt: new Date().toISOString() });
  }
  const saved = await saveWorkspace(projectId!, kind, body.data, session!.user.id);
  return NextResponse.json({ ok: true, updatedAt: saved.updatedAt });
}
