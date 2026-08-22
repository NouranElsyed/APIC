import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { scrapPricingInputsSchema } from "@/server/validators/nesting";
import { calculateScrapPricingForRun, ScrapPricingError } from "@/server/services/scrap-pricing.service";
import { buildScrapPricingWorkbook } from "@/server/services/scrap-pricing-export.service";
import { getProject } from "@/server/services/project.service";
import { z } from "zod";

const exportSchema = scrapPricingInputsSchema.extend({ projectId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const { res } = await requirePermission("scrapPricing.export");
  if (res) return res;

  const body = await req.json().catch(() => null);
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { nestingRunId, projectId, overridesByGroupKey, ...globals } = parsed.data;

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let result;
  try {
    result = await calculateScrapPricingForRun(nestingRunId, globals, overridesByGroupKey ?? {});
  } catch (err) {
    if (err instanceof ScrapPricingError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  const wb = buildScrapPricingWorkbook(result, {
    projectNumber: project.number,
    projectName: project.name,
    inputs: globals,
  });

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `SteelFlow_Scrap_Pricing_${project.number}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
