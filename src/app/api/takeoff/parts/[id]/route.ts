import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
<<<<<<< HEAD
import { saveAndParseDxf, deleteDxf } from "@/server/services/dxf.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "File is required" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".dxf")) {
    return NextResponse.json({ error: "Only .dxf files are accepted" }, { status: 400 });
  }

  try {
    const dxf = await saveAndParseDxf(id, file, session!.user.id);
    return NextResponse.json(dxf, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to process DXF" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  await deleteDxf(id, session!.user.id);
=======
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
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
  return NextResponse.json({ ok: true });
}
