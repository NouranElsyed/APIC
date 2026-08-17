import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { takeoffPartSchema } from "@/server/validators/takeoff";
import { updatePart, deletePart } from "@/server/services/takeoff.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;

  const { id } = await params;
  const body = await req.json();
  const parsed = takeoffPartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const part = await updatePart(id, parsed.data, session!.user.id);
  return NextResponse.json(part);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.delete");
  if (res) return res;
  const { id } = await params;
  await deletePart(id, session!.user.id);
  return NextResponse.json({ ok: true });
}
