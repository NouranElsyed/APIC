import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { getMaterialUsage } from "@/server/services/material-usage.service";
import { buildMaterialUsageWorkbook } from "@/server/services/material-usage-export.service";
import { buildUsage, DEFAULT_PRICES, DEFAULT_TARGET_PCT, parsePrice } from "@/features/material-usage/usage";
import { can } from "@/server/rbac/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.view");
  if (res) return res;
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const prices = { costPerKg: parsePrice(sp.get("costPerKg"), DEFAULT_PRICES.costPerKg), scrapPerKg: parsePrice(sp.get("scrapPerKg"), DEFAULT_PRICES.scrapPerKg) };
  const targetPct = parsePrice(sp.get("target"), DEFAULT_TARGET_PCT);

  const data = await getMaterialUsage(id, { planning: can(session!.user.role, "planning.view") });
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const { rows, totals } = buildUsage(data.parts, prices);

  const buf = await buildMaterialUsageWorkbook({ projectLabel: `${data.project.number} — ${data.project.name}`, currency: data.currency, prices, targetPct, rows, totals });
  const name = `${data.project.number}_material_usage`.replace(/[^A-Za-z0-9._-]+/g, "_");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
