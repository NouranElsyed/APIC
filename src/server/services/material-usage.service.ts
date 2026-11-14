// Data behind a project's Material & Usage tab: takeoff parts (used / purchase / scrap weights)
// plus the purchase-order history from the materials module.

import { prisma } from "@/server/db/client";
import { getProject } from "./project.service";
import { getPlanningData } from "./planning.service";
import { getMaterialsData } from "./materials.service";
import { getSettings } from "./settings.service";
import { cumulativeOrders, type UsagePart } from "@/features/material-usage/usage";
import type { Kpis } from "@/features/planning/metrics";

export interface MaterialUsageData {
  project: { id: string; number: string; name: string; startDate: string | null; endDate: string | null };
  currency: string;
  parts: UsagePart[];
  /** cumulative purchase-order value by month; empty when no priced orders exist */
  orderTrend: { key: string; label: string; value: number }[];
  kpis: Pick<Kpis, "delayDays" | "spi" | "hasBaseline"> | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function getMaterialUsage(projectId: string, access: { planning: boolean }): Promise<MaterialUsageData | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const [parts, planning, materials, settings] = await Promise.all([
    prisma.takeoffPart.findMany({
      where: { drawing: { projectId } },
      select: { partType: true, material: true, thicknessMm: true, weightKg: true, buyWeightKg: true, scrapKg: true },
    }),
    access.planning ? getPlanningData(projectId) : null,
    access.planning ? getMaterialsData(projectId) : null,
    getSettings(),
  ]);

  const orders = materials ? materials.items.flatMap((m) => m.orders.map((o) => ({ date: o.orderDate ?? null, value: o.value }))) : [];

  return {
    project: { id: project.id, number: project.number, name: project.name, startDate: iso(project.startDate), endDate: iso(project.endDate) },
    currency: settings?.currency || "EGP",
    parts: parts.map((p) => ({ partType: p.partType, material: p.material, thicknessMm: p.thicknessMm, weightKg: p.weightKg, buyWeightKg: p.buyWeightKg, scrapKg: p.scrapKg })),
    orderTrend: cumulativeOrders(orders),
    kpis: planning ? { delayDays: planning.kpis.delayDays, spi: planning.kpis.spi, hasBaseline: planning.kpis.hasBaseline } : null,
  };
}
