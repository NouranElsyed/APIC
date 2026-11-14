import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteHistory, renameHistory } from "@/server/services/nesting-history.service";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "A name is required" }, { status: 400 });
  const renamed = await renameHistory(session!.user.id, id, body.name);
  if (!renamed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(renamed);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  if (!(await deleteHistory(session!.user.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
