// Everything the per-project Reports tab shows, assembled from the planning, materials and quotation modules.

import { getProject } from "./project.service";
import { getPlanningData } from "./planning.service";
import { getMaterialsData } from "./materials.service";
import { getQuotationsData } from "./quotations.service";
import { costBreakdown, earnedValue, monthlySpi, type CostBreakdown, type SpiPoint } from "@/features/reports/project-report";
import type { Kpis, SCurve } from "@/features/planning/metrics";
import type { FrozenBudget } from "@/features/execution/execution";

export interface ProjectReportData {
  project: { id: string; number: string; name: string; customer: string; startDate: string | null; endDate: string | null };
  schedule: { name: string; dataDate: string; kpis: Kpis; scurve: SCurve; spi: SpiPoint[] } | null;
  /** null when the user is not allowed to see quotations (cost) */
  cost: (CostBreakdown & { earnedValue: number | null; frozen: boolean }) | null;
  materials: { items: number; percentDelivered: number; orderedValue: number; late: number; urgent: number } | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function getProjectReport(projectId: string, access: { planning: boolean; quotations: boolean }): Promise<ProjectReportData | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const [planning, materials, quotations] = await Promise.all([
    access.planning ? getPlanningData(projectId) : null,
    access.planning ? getMaterialsData(projectId) : null,
    access.quotations ? getQuotationsData(projectId) : null,
  ]);

  // Once the project is in execution its budget is the one frozen at the conversion, not whatever the quotations say today.
  const frozen = (project.executionBudget as FrozenBudget | null) ?? null;
  const live = quotations ? costBreakdown(quotations.rows) : null;
  const cost: CostBreakdown | null = live && frozen
    ? { basis: "approved", currency: frozen.currency, total: frozen.total, supply: frozen.supply, install: frozen.install, quotations: frozen.quotations.length }
    : live;

  return {
    project: { id: project.id, number: project.number, name: project.name, customer: project.customer.name, startDate: iso(project.startDate), endDate: iso(project.endDate) },
    schedule: planning
      ? { name: planning.schedule.name, dataDate: planning.schedule.dataDate, kpis: planning.kpis, scurve: planning.scurve, spi: monthlySpi(planning.scurve, planning.kpis.hasBaseline) }
      : null,
    cost: cost ? { ...cost, frozen: !!frozen, earnedValue: planning && cost.basis !== "none" ? earnedValue(cost.total, planning.kpis.progress) : null } : null,
    materials: materials && materials.items.length
      ? { items: materials.items.length, percentDelivered: materials.summary.percentDelivered, orderedValue: materials.summary.orderedValue, late: materials.summary.byStatus.LATE, urgent: materials.summary.urgent }
      : null,
  };
}
