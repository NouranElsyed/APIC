import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { stockAdjustSchema } from "@/server/validators/procurement";
import { adjustStock, listMovements } from "@/server/services/stock.service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("stock.view");
  if (res) return res;
  const { id } = await params;
  return NextResponse.json(await listMovements(id));
}

// Take from / add to a stock row (used on a project, scrapped, counted again …).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("stock.edit");
  if (res) return res;
  const body = await parseBody(req, stockAdjustSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    return NextResponse.json(await adjustStock(id, body.data, { id: session!.user.id, name: session!.user.name ?? "—" }));
  });
}
