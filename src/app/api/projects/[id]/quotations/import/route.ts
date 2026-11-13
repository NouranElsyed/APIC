import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { importQuotationFromExcel, QuotationError } from "@/server/services/quotations.service";

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("quotations.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    const file = (await req.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) throw new QuotationError("Choose an .xlsx file to import.");
    if (file.size > 10 * 1024 * 1024) throw new QuotationError("The file is larger than 10 MB.");
    return NextResponse.json(await importQuotationFromExcel(id, await file.arrayBuffer(), file.name, { id: session!.user.id, name: session!.user.name ?? "—" }));
  });
}
