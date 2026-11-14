import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { materialSchema } from "@/server/validators/materials";
import { createMaterial } from "@/server/services/materials.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, materialSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    const m = await createMaterial(id, body.data, session!.user.id);
    return NextResponse.json({ id: m.id }, { status: 201 });
  });
}
