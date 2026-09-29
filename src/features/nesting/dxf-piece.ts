import { parseDXF } from "./nest-boost/engine";

/** mm per drawing unit, keyed by the DXF $INSUNITS code. */
const INSUNITS_SCALE: Record<number, { label: string; scale: number }> = {
  1: { label: "in", scale: 25.4 },
  2: { label: "ft", scale: 304.8 },
  4: { label: "mm", scale: 1 },
  5: { label: "cm", scale: 10 },
  6: { label: "m", scale: 1000 },
};

/** Reads $INSUNITS from the DXF header. null = not present / unitless / unsupported. */
export function detectDxfUnits(text: string): { label: string; scale: number } | null {
  const m = text.match(/\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(\d+)/);
  if (!m) return null;
  return INSUNITS_SCALE[Number(m[1])] ?? null;
}

export interface DxfPiece {
  name: string;
  /** Cut length in mm = the longer side of the outline's bounding box. */
  length: number;
  /** The shorter side in mm (width of the strip), for information. */
  width: number;
  unitsLabel: string;
  contours: number;
}

/**
 * Turns one DXF drawing of a linear part (a bar / strip / flat pattern) into a 1D part.
 * The part is the largest closed outline in the file; its longer bounding-box side is the cut length.
 *
 * @param unitScale mm per drawing unit chosen by the user; null = read it from the file header
 *                  (falls back to millimetres when the file has no units).
 */
export function dxfToPiece(text: string, fileName: string, unitScale: number | null): DxfPiece | { error: string } {
  const { loops } = parseDXF(text);
  if (!loops.length) return { error: "no closed outline found" };

  let best: { w: number; h: number } | null = null;
  for (const loop of loops) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of loop) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const w = x1 - x0;
    const h = y1 - y0;
    if (!best || w * h > best.w * best.h) best = { w, h };
  }
  if (!best || !(Math.max(best.w, best.h) > 0)) return { error: "outline has no size" };

  const detected = detectDxfUnits(text);
  const scale = unitScale ?? detected?.scale ?? 1;
  const unitsLabel = unitScale != null ? "manual" : detected?.label ?? "mm (assumed)";
  const round = (v: number) => Math.round(v * 10) / 10;

  return {
    name: fileName.replace(/\.dxf$/i, ""),
    length: round(Math.max(best.w, best.h) * scale),
    width: round(Math.min(best.w, best.h) * scale),
    unitsLabel,
    contours: loops.length,
  };
}
