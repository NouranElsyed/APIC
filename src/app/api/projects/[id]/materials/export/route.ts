import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { PlanningError } from "@/server/services/planning.service";
import { getMaterialsData } from "@/server/services/materials.service";
import { buildMaterialsTemplate, buildMaterialsWorkbook } from "@/server/services/materials-export.service";
import { getProject } from "@/server/services/project.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "materials";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { res } = await requirePermission("planning.view");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    const headers = (name: string) => ({ "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" });
    if (req.nextUrl.searchParams.get("format") === "template") {
      return new NextResponse(new Uint8Array(await buildMaterialsTemplate()), { headers: headers("materials_template") });
    }
    const project = await getProject(id);
    if (!project) throw new PlanningError("Project not found", 404);
    const buf = await buildMaterialsWorkbook(await getMaterialsData(id), `${project.number} — ${project.name}`);
    return new NextResponse(new Uint8Array(buf), { headers: headers(safe(`${project.number}_materials`)) });
  });
}
