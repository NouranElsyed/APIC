import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { orderSchema } from "@/server/validators/materials";
import { deleteOrder, updateOrder } from "@/server/services/materials.service";

type Ctx = { params: Promise<{ id: string; materialId: string; orderId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, orderSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id, materialId, orderId } = await params;
    await updateOrder(id, materialId, orderId, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id, materialId, orderId } = await params;
    await deleteOrder(id, materialId, orderId, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
