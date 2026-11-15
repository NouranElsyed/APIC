import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { listReceipts } from "@/server/services/purchasing.service";

// Goods receipts, newest first. `heatNo` finds where a heat / lot of steel went (traceability).
export async function GET(req: NextRequest) {
  const { res } = await requirePermission("procurement.view");
  if (res) return res;
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(await listReceipts({ projectId: sp.get("projectId") ?? undefined, heatNo: sp.get("heatNo") ?? undefined }));
}
