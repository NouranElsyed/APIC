import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { receiptSchema } from "@/server/validators/procurement";
import { createGoodsReceipt } from "@/server/services/purchasing.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("procurement.receive");
  if (res) return res;
  const body = await parseBody(req, receiptSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    const r = await createGoodsReceipt(id, body.data, { id: session!.user.id, name: session!.user.name ?? "—" });
    return NextResponse.json(r, { status: 201 });
  });
}
