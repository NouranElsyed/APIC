import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { materialSchema } from "@/server/validators/materials";
import { createMaterial, getMaterialsData } from "@/server/services/materials.service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("planning.view");
  if (res) return res;
  return planningHandler(async () => NextResponse.json(await getMaterialsData((await params).id)));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, materialSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const m = await createMaterial((await params).id, body.data, session!.user.id);
    return NextResponse.json({ id: m.id }, { status: 201 });
  });
}
