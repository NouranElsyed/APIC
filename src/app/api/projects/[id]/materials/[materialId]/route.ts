import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { materialSchema } from "@/server/validators/materials";
import { deleteMaterial, updateMaterial } from "@/server/services/materials.service";

type Ctx = { params: Promise<{ id: string; materialId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, materialSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id, materialId } = await params;
    await updateMaterial(id, materialId, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id, materialId } = await params;
    await deleteMaterial(id, materialId, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
