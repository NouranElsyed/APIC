import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { getQuotationDetail, QuotationError } from "@/server/services/quotations.service";
import { buildQuotationWorkbook } from "@/server/services/quotations-export.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  const { res } = await requirePermission("quotations.view");
  if (res) return res;
  return planningHandler(async () => {
    const { id, qid } = await params;
    const q = await getQuotationDetail(id, qid);
    if (!q) throw new QuotationError("Quotation not found", 404);
    const name = `${q.number}${q.revision ? `_Rev${q.revision}` : ""}`.replace(/[^A-Za-z0-9._-]+/g, "_");
    return new NextResponse(new Uint8Array(await buildQuotationWorkbook(q)), { headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
  });
}
