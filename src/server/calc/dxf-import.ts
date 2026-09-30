// Turns a parsed DXF + a few per-row choices (type / side / qty / thickness…)
// into a ready-to-save takeoff part, so the user does not have to type the
// geometry part by part. Pure and dependency-free: used by the browser for the
// preview table AND by the server when the parts are actually created (the
// server re-parses the file, it never trusts numbers sent by the client).
//
// Units: the DXF parser already returns mm / m². Standard Calculations stores
// geometry lengths in metres, so bbox mm -> m here.
//
// PLATE      width x length = DXF bounding box, and the area removed
//            (bbox area - real net area, i.e. corners + holes) is stored as
//            `cutoffFormula`, so the default formula `width*length-(cutoff)`
//            gives EXACTLY the net area of the DXF. Editable afterwards like
//            any other plate.
// HOT_ROLLED length = longest side of the DXF bbox; profile and kg/m must come
//            from the row (they are not in a DXF).

import type { DxfGeometryResult, DxfPartGeometry } from "./dxf";

/** The bits of a parsed DXF (or one part of a multi-part DXF) the builder needs. */
export type DxfSize = Pick<DxfGeometryResult, "areaSqm" | "bboxWidthMm" | "bboxHeightMm"> & { valid?: boolean; errorMessage?: string | null };

/** Every importable part in a parsed file: one for a normal DXF, many for a multi-part sheet. */
export function importableParts(dxf: DxfGeometryResult): DxfPartGeometry[] {
  return dxf.parts.length > 0 && (dxf.valid || dxf.outerContourCount > 1) ? dxf.parts : [];
}

export function sizeOfPart(p: DxfPartGeometry): DxfSize {
  return { valid: true, areaSqm: p.areaSqm, bboxWidthMm: p.bboxWidthMm, bboxHeightMm: p.bboxHeightMm, errorMessage: null };
}

export type ImportPartType = "PLATE" | "HOT_ROLLED";

export interface ImportRowConfig {
  description: string;
  partType: ImportPartType;
  side: "INTERNAL" | "EXTERNAL";
  qty: number;
  thicknessMm: number | null;
  paintSides: 1 | 2;
  material: string;
  // HOT_ROLLED only
  profile?: string;
  weightPerMeter?: number | null;
  paintAreaPerMeter?: number | null;
}

const r = (v: number, digits: number) => Number(v.toFixed(digits));

/** Guess description / thickness / qty from names like "PL5_riser_x6.dxf". */
export function guessFromFileName(fileName: string): { description: string; thicknessMm?: number; qty?: number } {
  const base = fileName.replace(/\.dxf$/i, "").trim();
  const description = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || base;

  let thicknessMm: number | undefined;
  const thk =
    /(?:^|[^a-z0-9])(?:pl|plate|t|thk)?[\s_-]?(\d+(?:\.\d+)?)\s*mm(?![a-z])/i.exec(base) ??
    /(?:^|[^a-z0-9])(?:pl|thk|t)[\s_-]?(\d+(?:\.\d+)?)(?![\d.]*\s*x)/i.exec(base);
  if (thk) {
    const v = Number(thk[1]);
    if (Number.isFinite(v) && v > 0 && v <= 200) thicknessMm = v;
  }

  let qty: number | undefined;
  const q = /(?:qty|q)[\s_-]?(\d+)|(\d+)\s*(?:pcs|pc|nos|off)(?![a-z])|(?:^|[\s_-])x(\d+)(?:$|[\s_-])/i.exec(base);
  if (q) {
    const v = Number(q[1] ?? q[2] ?? q[3]);
    if (Number.isInteger(v) && v > 0 && v < 10000) qty = v;
  }
  return { description, thicknessMm, qty };
}

export type BuildResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; error: string };

/** Builds the payload accepted by takeoffPartSchema (minus drawingId/itemNo). */
export function buildPartFromDxf(dxf: DxfSize, cfg: ImportRowConfig): BuildResult {
  if (dxf.valid === false || dxf.areaSqm == null || dxf.bboxWidthMm == null || dxf.bboxHeightMm == null) {
    return { ok: false, error: dxf.errorMessage ?? "Invalid DXF" };
  }
  if (!cfg.description.trim()) return { ok: false, error: "Description is required" };
  if (!Number.isInteger(cfg.qty) || cfg.qty <= 0) return { ok: false, error: "Qty must be 1 or more" };

  const common = {
    description: cfg.description.trim(),
    material: cfg.material.trim() || null,
    side: cfg.side,
    qty: cfg.qty,
    paintSides: cfg.paintSides,
    buyWeightKg: null,
  };

  if (cfg.partType === "HOT_ROLLED") {
    const profile = (cfg.profile ?? "").trim();
    const wpm = cfg.weightPerMeter ?? 0;
    if (!profile) return { ok: false, error: "Profile is required for Hot Rolled" };
    if (!(wpm > 0)) return { ok: false, error: "Weight per metre is required for Hot Rolled" };
    const length = r(Math.max(dxf.bboxWidthMm, dxf.bboxHeightMm) / 1000, 4);
    if (!(length > 0)) return { ok: false, error: "Could not read a length from the DXF" };
    return {
      ok: true,
      input: {
        ...common,
        partType: "HOT_ROLLED",
        thicknessMm: cfg.thicknessMm && cfg.thicknessMm > 0 ? cfg.thicknessMm : null,
        geometry: { profile, length, weightPerMeter: wpm, paintAreaPerMeter: cfg.paintAreaPerMeter ?? null },
        areaFormula: null,
      },
    };
  }

  if (!cfg.thicknessMm || !(cfg.thicknessMm > 0)) return { ok: false, error: "Thickness is required" };
  const width = r(dxf.bboxWidthMm / 1000, 4);
  const length = r(dxf.bboxHeightMm / 1000, 4);
  if (!(width > 0) || !(length > 0)) return { ok: false, error: "DXF has no size" };
  const cutoff = r(width * length - dxf.areaSqm, 6);
  return {
    ok: true,
    input: {
      ...common,
      partType: "PLATE",
      thicknessMm: cfg.thicknessMm,
      geometry: { width, length, cutoffFormula: cutoff > 0.000001 ? String(cutoff) : null },
      areaFormula: null, // server falls back to width*length-(cutoff)
    },
  };
}
