import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { cancelPurchaseOrder, getPurchaseOrder } from "@/server/services/purchasing.service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("procurement.view");
  if (res) return res;
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  return po ? NextResponse.json(po) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

// Only one change is possible on an issued order: cancel it.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("procurement.edit");
  if (res) return res;
  const body = await parseBody(req, z.object({ status: z.literal("CANCELLED") }));
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    await cancelPurchaseOrder(id, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
