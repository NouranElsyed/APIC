// Mirrors the redesigned TakeoffPart model (see prisma/schema.prisma):
// every part has an explicit `partType` (PLATE / HOT_ROLLED / CONE / PIPE)
// which drives which geometry fields are relevant and what the default
// area formula looks like. The formula is always stored on the row
// (`areaFormula`) and is Excel-style editable by the user — this module
// only supplies the *default* so the popup isn't blank on first open.
//
// Sheet-based types (PLATE / CONE / PIPE):
//   unitArea  = evalFormula(areaFormula, geometryVars)   -- single-face
//               net area for ONE piece (already nets out any cut-out)
//   totalArea = unitArea * qty
//   volume    = totalArea * thicknessMm        (m2 * mm)
//   weightKg  = volume * STEEL_DENSITY_KG_PER_M2_MM
//   paintAreaSqm = totalArea * paintSides       (1 or 2 faces painted)
//
// HOT_ROLLED (rolled section — IPE/FB/angle/etc): weight is per metre of
// profile, not area x thickness x density, and there's no thicknessMm.
//   weightKg     = weightPerMeter * length * qty
//   paintAreaSqm = (paintAreaPerMeter ?? 0) * length * qty
//   totalArea / volume = 0 (not meaningful for a rolled section)
//
// Steel density constant: 7.85 kg per (m2 * mm) — the standard plate-weight
// factor (kg/m2 per mm of thickness).
//
// Scrap: buyWeightKg is a manual entry — the actual stock weight bought/
// allocated for this row. scrapKg/scrapPct are only present once
// buyWeightKg is set; both are null otherwise (never 0, so "no data
// entered yet" is distinguishable from "zero scrap").
import { evalFormula, FormulaError } from "./formula";

export const STEEL_DENSITY_KG_PER_M2_MM = 7.85;

export type PartType = "PLATE" | "HOT_ROLLED" | "CONE" | "PIPE";
export type PartSide = "INTERNAL" | "EXTERNAL";

export interface PlateGeometry {
  width: number;
  length: number;
  cutoffFormula?: string | null; // e.g. "PI()*0.15^2" — area removed for a cut-out/hole
}
export interface ConeGeometry {
  d1: number; // base diameter
  d2: number; // top diameter
  height: number;
}
export interface PipeGeometry {
  od: number; // outer diameter
  length: number;
}
export interface HotRolledGeometry {
  profile: string; // e.g. "IPE 120"
  length: number; // metres
  weightPerMeter: number; // kg/m, from the steel tables
  paintAreaPerMeter?: number | null; // m2/m, optional
}

export type TakeoffGeometry = PlateGeometry | ConeGeometry | PipeGeometry | HotRolledGeometry;

export interface TakeoffPartInput {
  partType: PartType;
  geometry: Record<string, unknown> | null | undefined;
  qty: number;
  thicknessMm?: number | null; // required for PLATE/CONE/PIPE, irrelevant for HOT_ROLLED
  paintSides?: number | null; // 1 or 2, defaults to 2 (both faces)
  areaFormula?: string | null; // sheet-based types only, Excel-style, editable
  buyWeightKg?: number | null; // manual: purchased/allocated stock weight
}

export interface TakeoffPartComputed {
  unitArea: number; // single piece, single face
  totalArea: number;
  volume: number;
  weightKg: number;
  paintAreaSqm: number;
  buyWeightKg: number | null;
  scrapKg: number | null;
  scrapPct: number | null;
  formulaError: string | null; // set when the area formula failed to evaluate
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// The default formula pre-filled into the "Add Item" popup for each part
// type — always visible and editable afterwards, Excel-style.
export function buildDefaultAreaFormula(partType: PartType, geometry: Record<string, unknown> | null | undefined): string {
  const g = (geometry ?? {}) as Record<string, unknown>;
  switch (partType) {
    case "PLATE": {
      const cutoff = typeof g.cutoffFormula === "string" ? g.cutoffFormula.trim() : "";
      return cutoff ? `width*length-(${cutoff})` : "width*length";
    }
    case "CONE":
      // Lateral surface area of a frustum (slant height via Pythagoras).
      return "PI()*((d1+d2)/2)*sqrt(height^2+((d1-d2)/2)^2)";
    case "PIPE":
      return "PI()*od*length";
    case "HOT_ROLLED":
    default:
      return "";
  }
}

function geometryVars(partType: PartType, geometry: Record<string, unknown> | null | undefined, thk: number, qty: number): Record<string, number> {
  const g = (geometry ?? {}) as Record<string, unknown>;
  const base = { thk, qty };
  if (partType === "PLATE") return { ...base, width: n(g.width), length: n(g.length) };
  if (partType === "CONE") return { ...base, d1: n(g.d1), d2: n(g.d2), height: n(g.height) };
  if (partType === "PIPE") return { ...base, od: n(g.od), length: n(g.length) };
  return base;
}

export function computeTakeoffPart(input: TakeoffPartInput): TakeoffPartComputed {
  const qty = n(input.qty);
  const thk = n(input.thicknessMm);
  const paintSides = input.paintSides === 1 ? 1 : 2;
  const g = (input.geometry ?? {}) as Record<string, unknown>;

  let unitArea = 0;
  let totalArea = 0;
  let volume = 0;
  let weightKg = 0;
  let paintAreaSqm = 0;
  let formulaError: string | null = null;

  if (input.partType === "HOT_ROLLED") {
    const weightPerMeter = n(g.weightPerMeter);
    const length = n(g.length);
    weightKg = weightPerMeter * length * qty;
    paintAreaSqm = n(g.paintAreaPerMeter) * length * qty;
  } else {
    const formula = (input.areaFormula ?? "").trim() || buildDefaultAreaFormula(input.partType, g);
    const vars = geometryVars(input.partType, g, thk, qty);
    try {
      unitArea = formula ? evalFormula(formula, vars) : 0;
    } catch (err) {
      unitArea = 0;
      formulaError = err instanceof FormulaError ? err.message : "Invalid formula";
    }
    totalArea = unitArea * qty;
    volume = totalArea * thk;
    weightKg = volume * STEEL_DENSITY_KG_PER_M2_MM;
    paintAreaSqm = totalArea * paintSides;
  }

  const buyWeightKg = typeof input.buyWeightKg === "number" && Number.isFinite(input.buyWeightKg)
    ? input.buyWeightKg
    : null;
  const scrapKg = buyWeightKg !== null ? buyWeightKg - weightKg : null;
  const scrapPct = buyWeightKg !== null && buyWeightKg > 0 ? (scrapKg as number) / buyWeightKg : null;

  return { unitArea, totalArea, volume, weightKg, paintAreaSqm, buyWeightKg, scrapKg, scrapPct, formulaError };
}

// Human-readable, numbers-substituted breakdown of exactly how a row's
// numbers were produced — used by the UI so the user can see (and check)
// the equation for a specific row instead of trusting a black box.
export interface TakeoffPartExplanation {
  lines: { label: string; formula: string; result: string }[];
}

function fmtNum(v: number, digits = 4) {
  return Number(v.toFixed(digits)).toString();
}

export function explainTakeoffPart(input: TakeoffPartInput): TakeoffPartExplanation {
  const c = computeTakeoffPart(input);
  const qty = n(input.qty);
  const thk = n(input.thicknessMm);
  const paintSides = input.paintSides === 1 ? 1 : 2;
  const lines: TakeoffPartExplanation["lines"] = [];

  if (input.partType === "HOT_ROLLED") {
    const g = (input.geometry ?? {}) as Record<string, unknown>;
    lines.push({
      label: "Weight (per metre × length × qty)",
      formula: `${fmtNum(n(g.weightPerMeter))} × ${fmtNum(n(g.length))} × ${qty}`,
      result: `${fmtNum(c.weightKg, 2)} kg`,
    });
    if (n(g.paintAreaPerMeter) > 0) {
      lines.push({
        label: "Paint area (per metre × length × qty)",
        formula: `${fmtNum(n(g.paintAreaPerMeter))} × ${fmtNum(n(g.length))} × ${qty}`,
        result: `${fmtNum(c.paintAreaSqm)} m²`,
      });
    }
    return { lines };
  }

  lines.push({
    label: "Unit area (per piece, single face)",
    formula: (input.areaFormula ?? "").trim() || buildDefaultAreaFormula(input.partType, input.geometry),
    result: c.formulaError ? `Error: ${c.formulaError}` : `${fmtNum(c.unitArea)} m²`,
  });
  lines.push({
    label: "Total area (× qty)",
    formula: `${fmtNum(c.unitArea)} × ${qty}`,
    result: `${fmtNum(c.totalArea)} m²`,
  });
  lines.push({
    label: "Volume",
    formula: `${fmtNum(c.totalArea)} × ${fmtNum(thk)}`,
    result: `${fmtNum(c.volume)}`,
  });
  lines.push({
    label: "Weight",
    formula: `${fmtNum(c.volume)} × 7.85`,
    result: `${fmtNum(c.weightKg, 2)} kg`,
  });
  lines.push({
    label: `Paint area (${paintSides} side${paintSides > 1 ? "s" : ""})`,
    formula: `${fmtNum(c.totalArea)} × ${paintSides}`,
    result: `${fmtNum(c.paintAreaSqm)} m²`,
  });

  if (c.buyWeightKg !== null) {
    lines.push({
      label: "Scrap",
      formula: `${fmtNum(c.buyWeightKg, 1)} − ${fmtNum(c.weightKg, 1)}`,
      result: `${fmtNum(c.scrapKg ?? 0, 1)} kg${c.scrapPct !== null ? ` (${fmtNum(c.scrapPct * 100, 1)}%)` : ""}`,
    });
  }

  return { lines };
}

export function sumDrawingWeight(parts: { weightKg: number | null | undefined }[]) {
  return parts.reduce((sum, p) => sum + n(p.weightKg), 0);
}

export function sumDrawingArea(parts: { totalArea: number | null | undefined }[]) {
  return parts.reduce((sum, p) => sum + n(p.totalArea), 0);
}

export function sumDrawingScrap(parts: { scrapKg: number | null | undefined }[]) {
  const withScrap = parts.filter((p) => typeof p.scrapKg === "number" && Number.isFinite(p.scrapKg));
  if (withScrap.length === 0) return null;
  return withScrap.reduce((sum, p) => sum + n(p.scrapKg), 0);
}
