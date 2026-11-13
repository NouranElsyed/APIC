import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { getProject } from "@/server/services/project.service";
import { getQuotationsData, QuotationError } from "@/server/services/quotations.service";
import { buildQuotationsListWorkbook, buildQuotationTemplate } from "@/server/services/quotations-export.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const hdr = (name: string) => ({ "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { res } = await requirePermission("quotations.view");
  if (res) return res;
  return planningHandler(async () => {
    if (req.nextUrl.searchParams.get("format") === "template") return new NextResponse(new Uint8Array(await buildQuotationTemplate()), { headers: hdr("quotation_boq_template") });
    const { id } = await params;
    const project = await getProject(id);
    if (!project) throw new QuotationError("Project not found", 404);
    const buf = await buildQuotationsListWorkbook(await getQuotationsData(id), `${project.number} — ${project.name}`);
    return new NextResponse(new Uint8Array(buf), { headers: hdr(`${project.number}_quotations`.replace(/[^A-Za-z0-9._-]+/g, "_")) });
  });
}
