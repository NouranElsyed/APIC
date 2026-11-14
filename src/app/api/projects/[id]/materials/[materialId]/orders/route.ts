import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { orderSchema } from "@/server/validators/materials";
import { createOrder } from "@/server/services/materials.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, orderSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id, materialId } = await params;
    const o = await createOrder(id, materialId, body.data, session!.user.id);
    return NextResponse.json({ id: o.id }, { status: 201 });
  });
}
