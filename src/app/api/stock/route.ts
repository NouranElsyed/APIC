import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { stockCreateSchema } from "@/server/validators/procurement";
import { addStock, listStock } from "@/server/services/stock.service";

export async function GET(req: NextRequest) {
  const { res } = await requirePermission("stock.view");
  if (res) return res;
  const sp = req.nextUrl.searchParams;
  const th = Number(sp.get("thicknessMm"));
  return NextResponse.json(await listStock({ includeEmpty: sp.get("all") === "1", thicknessMm: th > 0 ? th : undefined, material: sp.get("material") ?? undefined }));
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("stock.edit");
  if (res) return res;
  const body = await parseBody(req, stockCreateSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const item = await addStock(body.data, { id: session!.user.id, name: session!.user.name ?? "—" }, { reason: "ADDED", origin: "MANUAL" });
    return NextResponse.json(item, { status: 201 });
  });
}
