import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { purchaseOrderSchema } from "@/server/validators/procurement";
import { createPurchaseOrder, listPurchaseOrders } from "@/server/services/purchasing.service";

export async function GET(req: NextRequest) {
  const { res } = await requirePermission("procurement.view");
  if (res) return res;
  return NextResponse.json(await listPurchaseOrders({ projectId: req.nextUrl.searchParams.get("projectId") ?? undefined }));
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("procurement.edit");
  if (res) return res;
  const body = await parseBody(req, purchaseOrderSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const po = await createPurchaseOrder(body.data, { id: session!.user.id, name: session!.user.name ?? "—" });
    return NextResponse.json(po, { status: 201 });
  });
}
