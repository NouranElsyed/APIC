// Mirrors "Riser Duct Fabrication Drg" sheet formulas, plus an alternate
// area mode for parts that aren't ducts (plate with a cut-out hole).
//
// areaMode "ADD" (default, matches the original Excel sheet — duct walls,
// where external and internal are two SEPARATE surfaces to add together):
//   extUnitArea   = extWidth * extLength * 2        (both faces)
//   intUnitArea   = intWidth * intLength * 2        (both faces)
//   totalUnitArea = extUnitArea + intUnitArea
//
// areaMode "SUBTRACT" (a flat plate with a hole/cut-out in it — internal
// dims describe material REMOVED from the external footprint, not a
// second surface):
//   netFaceArea   = max(extWidth*extLength - intWidth*intLength, 0)
//   totalUnitArea = netFaceArea * 2                 (kept *2 so the shared
//                                                     pipeline below stays
//                                                     identical between modes)
//
// Either way, from totalUnitArea on the pipeline is the same:
//   totalArea  = totalUnitArea * qty
//   volume     = (totalArea / 2) * thicknessMm   (halved back to single-face area)
//   weightKg   = volume * STEEL_DENSITY
//
// Steel density constant: 7.85 kg per (m2 * mm) — the standard plate-weight
// factor (kg/m2 per mm of thickness), taken directly from the source sheet.
export const STEEL_DENSITY_KG_PER_M2_MM = 7.85;

export type TakeoffAreaMode = "ADD" | "SUBTRACT";

export interface TakeoffPartInput {
  extWidth?: number | null;
  extLength?: number | null;
  intWidth?: number | null;
  intLength?: number | null;
  qty: number;
  thicknessMm: number;
  paintSides?: number | null; // 1 or 2, defaults to 2 (both faces)
  areaMode?: TakeoffAreaMode | null; // defaults to ADD
}

export interface TakeoffPartComputed {
  extUnitArea: number;
  intUnitArea: number;
  totalUnitArea: number;
  totalArea: number;
  volume: number;
  weightKg: number;
  paintAreaSqm: number;
}

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function rawArea(width?: number | null, length?: number | null) {
  const w = n(width);
  const l = n(length);
  if (!w || !l) return 0;
  return w * l;
}

export function resolveAreaMode(mode?: TakeoffAreaMode | null): TakeoffAreaMode {
  return mode === "SUBTRACT" ? "SUBTRACT" : "ADD";
}

export function computeTakeoffPart(input: TakeoffPartInput): TakeoffPartComputed {
  const mode = resolveAreaMode(input.areaMode);
  const qty = n(input.qty);
  const thicknessMm = n(input.thicknessMm);

  let extUnitArea: number;
  let intUnitArea: number;
  let totalUnitArea: number;

  if (mode === "SUBTRACT") {
    // Outer footprint minus the cut-out — a single net face, not two
    // separate surfaces. *2 here only to reuse the shared /2 pipeline below.
    extUnitArea = rawArea(input.extWidth, input.extLength);
    intUnitArea = rawArea(input.intWidth, input.intLength);
    const netFaceArea = Math.max(extUnitArea - intUnitArea, 0);
    totalUnitArea = netFaceArea * 2;
  } else {
    extUnitArea = rawArea(input.extWidth, input.extLength) * 2;
    intUnitArea = rawArea(input.intWidth, input.intLength) * 2;
    totalUnitArea = extUnitArea + intUnitArea;
  }

  const totalArea = totalUnitArea * qty;
  const volume = (totalArea / 2) * thicknessMm;
  const weightKg = volume * STEEL_DENSITY_KG_PER_M2_MM;

  // Painting scope only — never feeds into volume/weightKg above.
  // totalArea always represents both physical faces (the *2 above, in
  // either mode), so totalArea / 2 is the area of ONE face; multiply by
  // 1 or 2 depending on how many faces get painted.
  const paintSides = input.paintSides === 1 ? 1 : 2;
  const paintAreaSqm = (totalArea / 2) * paintSides;

  return { extUnitArea, intUnitArea, totalUnitArea, totalArea, volume, weightKg, paintAreaSqm };
}

// Human-readable, numbers-substituted breakdown of exactly how a row's
// numbers were produced — used by the UI so the user can see (and check)
// the equation for a specific row instead of trusting a black box.
export interface TakeoffPartExplanation {
  mode: TakeoffAreaMode;
  lines: { label: string; formula: string; result: string }[];
}

function fmtNum(v: number, digits = 4) {
  return Number(v.toFixed(digits)).toString();
}

export function explainTakeoffPart(input: TakeoffPartInput): TakeoffPartExplanation {
  const mode = resolveAreaMode(input.areaMode);
  const c = computeTakeoffPart(input);
  const extW = n(input.extWidth), extL = n(input.extLength);
  const intW = n(input.intWidth), intL = n(input.intLength);
  const qty = n(input.qty), thk = n(input.thicknessMm);
  const paintSides = input.paintSides === 1 ? 1 : 2;

  const lines: TakeoffPartExplanation["lines"] = [];

  if (mode === "SUBTRACT") {
    lines.push({
      label: "Ext. area (outer footprint)",
      formula: `${fmtNum(extW)} × ${fmtNum(extL)}`,
      result: `${fmtNum(c.extUnitArea)} m²`,
    });
    lines.push({
      label: "Int. area (cut-out, removed)",
      formula: `${fmtNum(intW)} × ${fmtNum(intL)}`,
      result: `${fmtNum(c.intUnitArea)} m²`,
    });
    lines.push({
      label: "Net face area",
      formula: `${fmtNum(c.extUnitArea)} − ${fmtNum(c.intUnitArea)}`,
      result: `${fmtNum(c.totalUnitArea / 2)} m²`,
    });
  } else {
    lines.push({
      label: "Ext. unit area (both faces)",
      formula: `${fmtNum(extW)} × ${fmtNum(extL)} × 2`,
      result: `${fmtNum(c.extUnitArea)} m²`,
    });
    lines.push({
      label: "Int. unit area (both faces)",
      formula: `${fmtNum(intW)} × ${fmtNum(intL)} × 2`,
      result: `${fmtNum(c.intUnitArea)} m²`,
    });
    lines.push({
      label: "Total unit area",
      formula: `${fmtNum(c.extUnitArea)} + ${fmtNum(c.intUnitArea)}`,
      result: `${fmtNum(c.totalUnitArea)} m²`,
    });
  }

  lines.push({
    label: "Total area (× qty)",
    formula: `${fmtNum(c.totalUnitArea)} × ${qty}`,
    result: `${fmtNum(c.totalArea)} m²`,
  });
  lines.push({
    label: "Volume",
    formula: `(${fmtNum(c.totalArea)} / 2) × ${fmtNum(thk)}`,
    result: `${fmtNum(c.volume)}`,
  });
  lines.push({
    label: "Weight",
    formula: `${fmtNum(c.volume)} × 7.85`,
    result: `${fmtNum(c.weightKg, 2)} kg`,
  });
  lines.push({
    label: `Paint area (${paintSides} side${paintSides > 1 ? "s" : ""})`,
    formula: `(${fmtNum(c.totalArea)} / 2) × ${paintSides}`,
    result: `${fmtNum(c.paintAreaSqm)} m²`,
  });

  return { mode, lines };
}

export function sumDrawingWeight(parts: { weightKg: number | null | undefined }[]) {
  return parts.reduce((sum, p) => sum + n(p.weightKg), 0);
}

export function sumDrawingArea(parts: { totalArea: number | null | undefined }[]) {
  return parts.reduce((sum, p) => sum + n(p.totalArea), 0);
}
