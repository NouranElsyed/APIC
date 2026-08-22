import { getNestingRun } from "./nesting-run.service";
import { prisma } from "@/server/db/client";
import { getEligibleNestingParts } from "./nesting.service";
import { STEEL_DENSITY_KG_PER_M2_MM } from "@/server/calc/takeoff";
import {
  calculateScrapPricingRow,
  calculateScrapPricingTotals,
  type ScrapPricingRowInput,
  type ScrapPricingRowResult,
  type ScrapPricingTotals,
} from "@/server/calc/scrap-pricing";
import type { SourceRequirementRow, EligiblePart } from "@/features/nesting/types";

// Everything the export needs beyond the pricing calc itself: the Part List
// (what was taken off) and the Nesting layout (what the engine actually
// placed), so the workbook can mirror the reference file's three sections —
// Part List, Nesting, Scrap Calculation — instead of just the last one.
export interface ScrapPricingExportContext {
  parts: EligiblePart[];
  sheets: Array<{
    sheetNumber: number;
    material: string;
    thicknessMm: number;
    widthMm: number;
    lengthMm: number;
    usedAreaSqm: number | null;
    scrapAreaSqm: number | null;
    utilizationPercent: number | null;
    placements: Array<{
      itemNo: number | null;
      description: string | null;
      instanceNumber: number;
      xMm: number;
      yMm: number;
      rotationDeg: number;
    }>;
  }>;
}

export async function getScrapPricingExportContext(nestingRunId: string): Promise<ScrapPricingExportContext> {
  const run = await getNestingRun(nestingRunId);
  if (!run) throw new ScrapPricingError("Nesting run not found");

  const job = await prisma.nestingJob.findUnique({ where: { id: run.nestingJobId }, select: { projectId: true } });
  if (!job) throw new ScrapPricingError("Nesting job not found");

  const eligible = await getEligibleNestingParts(job.projectId);

  // Placements only carry takeoffPartId; look the referenced parts up once
  // and join in-memory rather than re-shaping getNestingRun's include (that
  // shape is shared with the on-screen Nesting views).
  interface RunSheet {
    sheetNumber: number;
    material: string;
    thicknessMm: number;
    widthMm: number;
    lengthMm: number;
    usedAreaSqm: number | null;
    scrapAreaSqm: number | null;
    utilizationPercent: number | null;
    placements: Array<{ takeoffPartId: string; instanceNumber: number; xMm: number; yMm: number; rotationDeg: number }>;
  }
  const runSheets = run.sheets as unknown as RunSheet[];

  const partIds = [...new Set(runSheets.flatMap((s: RunSheet) => s.placements.map((p) => p.takeoffPartId)))];
  interface TakeoffPartLite { id: string; itemNo: number; description: string }
  const takeoffParts: TakeoffPartLite[] = partIds.length
    ? await prisma.takeoffPart.findMany({ where: { id: { in: partIds } }, select: { id: true, itemNo: true, description: true } })
    : [];
  const partById = new Map(takeoffParts.map((p) => [p.id, p]));

  const sheets = runSheets.map((s: RunSheet) => ({
    sheetNumber: s.sheetNumber,
    material: s.material,
    thicknessMm: s.thicknessMm,
    widthMm: s.widthMm,
    lengthMm: s.lengthMm,
    usedAreaSqm: s.usedAreaSqm,
    scrapAreaSqm: s.scrapAreaSqm,
    utilizationPercent: s.utilizationPercent,
    placements: s.placements
      .map((p) => ({
        itemNo: partById.get(p.takeoffPartId)?.itemNo ?? null,
        description: partById.get(p.takeoffPartId)?.description ?? null,
        instanceNumber: p.instanceNumber,
        xMm: p.xMm,
        yMm: p.yMm,
        rotationDeg: p.rotationDeg,
      }))
      .sort((a, b) => (a.itemNo ?? 0) - (b.itemNo ?? 0) || a.instanceNumber - b.instanceNumber),
  }));

  return { parts: eligible.included, sheets };
}

export class ScrapPricingError extends Error {}

// One material+thickness group's raw geometry, before any pricing inputs
// are applied — pure Nesting Engine output (PROJECT.md §4/§15: never
// bounding-box area, never a manually-entered sheet quantity).
export interface ScrapPricingGroupBase {
  key: string;
  material: string;
  thicknessMm: number;
  usedAreaSqm: number;
  usedWeightKg: number;
  buyQty: number;
  buyAreaSqm: number;
  buyWeightKg: number;
}

// Per-group manual overrides. Falls back to the global defaults supplied
// alongside this map when a group has no override of its own.
export interface ScrapPricingGroupInputs {
  costPerKg?: number;
  usedLaterPct?: number; // 0..1
  usedLaterPriceLEPerKg?: number;
  scrapSellPriceLEPerKg?: number;
}

export interface ScrapPricingGlobalInputs {
  costPerKg: number;
  usedLaterPct: number; // 0..1
  usedLaterPriceLEPerKg: number;
  scrapSellPriceLEPerKg: number;
}

export interface ScrapPricingResult {
  nestingRunId: string;
  rows: ScrapPricingRowResult[];
  totals: ScrapPricingTotals;
}

/** Purely-geometric aggregation step — no pricing inputs involved yet. */
export async function getScrapPricingGroups(nestingRunId: string): Promise<ScrapPricingGroupBase[]> {
  const run = await getNestingRun(nestingRunId);
  if (!run) throw new ScrapPricingError("Nesting run not found");

  const requirement = (run.sourceRequirementJson as unknown as SourceRequirementRow[] | null) ?? [];

  const map = new Map<string, ScrapPricingGroupBase>();
  const key = (material: string, thicknessMm: number) => `${material}||${thicknessMm}`;

  // Used Material — actual DXF-nested area per sheet, as computed by the
  // Nesting Engine (never a bounding-box approximation).
  for (const sheet of run.sheets) {
    const k = key(sheet.material, sheet.thicknessMm);
    const entry = map.get(k) ?? {
      key: k, material: sheet.material, thicknessMm: sheet.thicknessMm,
      usedAreaSqm: 0, usedWeightKg: 0, buyQty: 0, buyAreaSqm: 0, buyWeightKg: 0,
    };
    entry.usedAreaSqm += sheet.usedAreaSqm ?? 0;
    map.set(k, entry);
  }

  // Purchased Material — the automatically-calculated purchasing
  // requirement (required sheet qty x sheet area), never manually entered.
  for (const req of requirement) {
    const k = key(req.material, req.thicknessMm);
    const entry = map.get(k) ?? {
      key: k, material: req.material, thicknessMm: req.thicknessMm,
      usedAreaSqm: 0, usedWeightKg: 0, buyQty: 0, buyAreaSqm: 0, buyWeightKg: 0,
    };
    const sheetAreaSqm = (req.widthMm / 1000) * (req.lengthMm / 1000);
    entry.buyQty += req.requiredQty;
    entry.buyAreaSqm += sheetAreaSqm * req.requiredQty;
    map.set(k, entry);
  }

  for (const entry of map.values()) {
    entry.usedWeightKg = entry.usedAreaSqm * entry.thicknessMm * STEEL_DENSITY_KG_PER_M2_MM;
    entry.buyWeightKg = entry.buyAreaSqm * entry.thicknessMm * STEEL_DENSITY_KG_PER_M2_MM;
  }

  return [...map.values()].sort((a, b) => a.material.localeCompare(b.material) || a.thicknessMm - b.thicknessMm);
}

/** Applies pricing inputs (global + optional per-group overrides) and runs the calc engine. */
export async function calculateScrapPricingForRun(
  nestingRunId: string,
  globals: ScrapPricingGlobalInputs,
  overridesByGroupKey: Record<string, ScrapPricingGroupInputs> = {},
): Promise<ScrapPricingResult> {
  const groups = await getScrapPricingGroups(nestingRunId);

  const rowInputs: ScrapPricingRowInput[] = groups.map((g) => {
    const o = overridesByGroupKey[g.key] ?? {};
    return {
      key: g.key,
      itemLabel: `${g.material} ${g.thicknessMm} mm`,
      material: g.material,
      thicknessMm: g.thicknessMm,
      usedAreaSqm: g.usedAreaSqm,
      usedWeightKg: g.usedWeightKg,
      buyQty: g.buyQty,
      buyAreaSqm: g.buyAreaSqm,
      buyWeightKg: g.buyWeightKg,
      costPerKg: o.costPerKg ?? globals.costPerKg,
      usedLaterPct: o.usedLaterPct ?? globals.usedLaterPct,
      usedLaterPriceLEPerKg: o.usedLaterPriceLEPerKg ?? globals.usedLaterPriceLEPerKg,
      scrapSellPriceLEPerKg: o.scrapSellPriceLEPerKg ?? globals.scrapSellPriceLEPerKg,
    };
  });

  const rows = rowInputs.map(calculateScrapPricingRow);
  const totals = calculateScrapPricingTotals(rows);

  return { nestingRunId, rows, totals };
}
