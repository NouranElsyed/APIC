// Data behind a project's Material & Usage tab: takeoff parts (used / purchase / scrap weights)
// plus the purchase-order history from the materials module.

import { ensureNestInSync } from "./nest-sync-guard";
import { prisma } from "@/server/db/client";
import { getProject } from "./project.service";
import { getPlanningData } from "./planning.service";
import { getMaterialsData } from "./materials.service";
import { getSettings } from "./settings.service";
import { listSuppliers } from "./suppliers.service";
import { cumulativeOrders, type UsagePart } from "@/features/material-usage/usage";
import type { Kpis } from "@/features/planning/metrics";
import { classify, findGrade, parseNestCode, r1, sheetKg, standardOf, statusOf, type ReqRow, type ReqType } from "@/features/material-usage/requirements";

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
  await ensureNestInSync(projectId);
  const project = await getProject(projectId);
  if (!project) return null;

  const [parts, planning, materials, settings] = await Promise.all([
    prisma.takeoffPart.findMany({
      where: { drawing: { projectId }, partType: { not: "ACCESSORY" } },
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


// ----------------------------------------------------------------------------- Raw Material Requirements

export interface MaterialRequirementsData {
  project: { id: string; number: string; name: string };
  projects: { id: string; label: string }[];
  rows: ReqRow[];
  suppliers: { id: string; name: string }[];
  currency: string;
  /** "MATERIALS" = the project's Materials list (sent from nesting / typed in); "PART_LIST" = worked out from the Part List */
  source: "MATERIALS" | "PART_LIST" | "NONE";
}

type StockLite = { material: string; thicknessMm: number; widthMm: number; heightMm: number; qty: number };
const sameSize = (s: StockLite, w: number, h: number) => (Math.round(s.widthMm) === w && Math.round(s.heightMm) === h) || (Math.round(s.widthMm) === h && Math.round(s.heightMm) === w);
const sameGrade = (stockMat: string, grade: string | null) => !grade || !stockMat || stockMat.trim().toLowerCase() === grade.trim().toLowerCase();

export async function getMaterialRequirements(projectId: string): Promise<MaterialRequirementsData | null> {
  await ensureNestInSync(projectId);
  const project = await getProject(projectId);
  if (!project) return null;

  const [projects, planMaterials, stock, parts, suppliers, settings] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, number: true, name: true }, take: 100 }),
    prisma.planMaterial.findMany({ where: { projectId }, include: { orders: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.stockItem.findMany({ where: { kind: "SHEET", qty: { gt: 0 } }, select: { material: true, thicknessMm: true, widthMm: true, heightMm: true, qty: true } }),
    prisma.takeoffPart.findMany({
      where: { drawing: { projectId }, partType: { not: "ACCESSORY" } },
      select: { partType: true, description: true, material: true, thicknessMm: true, qty: true, weightKg: true },
    }),
    listSuppliers(),
    getSettings(),
  ]);

  const rows: ReqRow[] = [];
  let source: MaterialRequirementsData["source"] = "NONE";

  if (planMaterials.length) {
    source = "MATERIALS";
    for (const m of planMaterials) {
      const nest = parseNestCode(m.code);
      const text = `${m.code ?? ""} ${m.description} ${m.spec ?? ""}`;
      const type: ReqType = nest ? "Plate" : classify(text);
      const grade = nest?.grade ?? findGrade(m.description, m.spec, m.code) ?? "—";
      const ordered = m.orders.reduce((s, o) => s + o.orderedQty, 0);
      const received = m.orders.reduce((s, o) => s + o.receivedQty, 0);
      let inStock = 0;
      let weightKg: number | null = m.unit.toLowerCase() === "kg" ? m.requiredQty : null;
      if (nest) {
        const perSheet = sheetKg(nest.thicknessMm, nest.widthMm, nest.heightMm);
        const sheets = stock.filter((s) => Math.abs(s.thicknessMm - nest.thicknessMm) < 0.01 && sameSize(s, nest.widthMm, nest.heightMm) && sameGrade(s.material, nest.grade)).reduce((a, s) => a + s.qty, 0);
        inStock = m.unit.toLowerCase() === "kg" ? sheets * perSheet : sheets;
        if (weightKg == null) weightKg = r1(m.requiredQty * perSheet);
      }
      const available = r1(inStock + received);
      const shortage = r1(Math.max(0, m.requiredQty - available));
      rows.push({
        id: m.id, materialId: m.id, type, grade, standard: standardOf(grade, type),
        spec: nest ? `PL ${nest.thicknessMm} × ${nest.widthMm} × ${nest.heightMm} mm` : m.spec ? `${m.description} · ${m.spec}` : m.description,
        thicknessMm: nest?.thicknessMm ?? null, widthMm: nest?.widthMm ?? null, lengthMm: nest?.heightMm ?? null,
        required: m.requiredQty, unit: m.unit, weightKg, available, ordered: r1(ordered), received: r1(received), shortage, toOrder: r1(Math.max(0, shortage - Math.max(0, ordered - received))),
        status: statusOf(shortage, available, ordered, received), source: "MATERIALS", notes: m.notes,
      });
    }
  } else if (parts.length) {
    // Nothing sent to Materials yet: work the needs out from the Part List (kg per material / thickness / section).
    source = "PART_LIST";
    const groups = new Map<string, { type: ReqType; spec: string; grade: string; th: number | null; kg: number; pcs: number }>();
    for (const p of parts) {
      const grade = p.material?.trim() || findGrade(p.description) || "—";
      const type: ReqType = p.partType === "PIPE" ? "Pipe" : p.partType === "HOT_ROLLED" ? (classify(p.description) === "Flat" ? "Flat" : "Profile") : "Plate";
      const th = p.thicknessMm ?? null;
      const spec = type === "Plate" ? `${p.partType === "CONE" ? "Cone plate" : "PL"} ${th ?? "?"} mm` : type === "Pipe" ? `${p.description}${th ? ` · ${th} mm wall` : ""}` : p.description;
      const key = `${type}|${spec}|${grade}`;
      const g = groups.get(key) ?? { type, spec, grade, th, kg: 0, pcs: 0 };
      g.kg += p.weightKg; g.pcs += p.qty;
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      const inStock = g.type === "Plate" && g.th ? stock.filter((s) => Math.abs(s.thicknessMm - g.th!) < 0.01 && sameGrade(s.material, g.grade === "—" ? null : g.grade)).reduce((a, s) => a + s.qty * sheetKg(s.thicknessMm, s.widthMm, s.heightMm), 0) : 0;
      const required = r1(g.kg);
      const available = r1(inStock);
      const shortage = r1(Math.max(0, required - available));
      rows.push({
        id: key, materialId: null, type: g.type, spec: g.spec, grade: g.grade, standard: standardOf(g.grade, g.type), thicknessMm: g.th, widthMm: null, lengthMm: null,
        required, unit: "kg", weightKg: required, available, ordered: 0, received: 0, shortage, toOrder: shortage, status: statusOf(shortage, available, 0, 0), source: "PART_LIST",
        notes: `${g.pcs} piece${g.pcs === 1 ? "" : "s"} in the Part List`,
      });
    }
  }
  const order: Record<string, number> = { Plate: 0, Pipe: 1, Profile: 2, Flat: 3, Other: 4 };
  rows.sort((a, b) => order[a.type] - order[b.type] || (a.thicknessMm ?? 0) - (b.thicknessMm ?? 0) || a.spec.localeCompare(b.spec));

  return {
    project: { id: project.id, number: project.number, name: project.name },
    projects: projects.map((p) => ({ id: p.id, label: `${p.number} · ${p.name}` })),
    rows, source, currency: settings?.currency || "EGP",
    suppliers: suppliers.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })),
  };
}
