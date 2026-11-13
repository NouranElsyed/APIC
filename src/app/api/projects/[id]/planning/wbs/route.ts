import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { wbsSchema } from "@/server/validators/planning";
import { deleteWbs, updateWbs } from "@/server/services/planning.service";

type Ctx = { params: Promise<{ id: string; wbsId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, wbsSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id, wbsId } = await params;
    await updateWbs(id, wbsId, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id, wbsId } = await params;
    await deleteWbs(id, wbsId, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
