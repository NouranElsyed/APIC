import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteHistory, renameHistory } from "@/server/services/nesting-history.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "A name is required" }, { status: 400 });
  const updated = await renameHistory(session!.user.id, id, body.name);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  if (!(await deleteHistory(session!.user.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
