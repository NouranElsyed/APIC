import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { cancelPurchaseOrder, getPurchaseOrder, updatePurchaseOrder } from "@/server/services/purchasing.service";
import { purchaseOrderUpdateSchema } from "@/server/validators/procurement";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("procurement.view");
  if (res) return res;
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  return po ? NextResponse.json(po) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

// Two changes: cancel the order ({ status: "CANCELLED" }) or edit it before anything is received (the update schema).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("procurement.edit");
  if (res) return res;
  const body = await parseBody(req, z.union([z.object({ status: z.literal("CANCELLED") }), purchaseOrderUpdateSchema]));
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    if ("status" in body.data) {
      await cancelPurchaseOrder(id, session!.user.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await updatePurchaseOrder(id, body.data, { id: session!.user.id, name: session!.user.name ?? "" }));
  });
}
