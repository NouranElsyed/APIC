import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { takeoffPartSchema } from "@/server/validators/takeoff";
import { deletePart, updatePart } from "@/server/services/takeoff.service";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = takeoffPartSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const part = await updatePart(id, parsed.data, session!.user.id);
  return NextResponse.json(part);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("takeoff.delete");
  if (res) return res;
  const { id } = await params;
  await deletePart(id, session!.user.id);
  return NextResponse.json({ ok: true });
}
