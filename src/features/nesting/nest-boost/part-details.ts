import type { Group } from "./engine";
import { holeLines, shapeFormula, type HoleLine, type ShapeFormula } from "./part-formula";

/** Steel density: kg per (m² · mm) — same constant the nesting report and Standard Calculations use (7850 kg/m³). */
export const STEEL_KG_PER_M2_MM = 7.85;

export interface PartDetails {
  /** Net area of one piece (mm²) — outline minus holes. This is the "Area" column. */
  netMm2: number;
  /** Area inside the outline before the holes are taken out (mm²). */
  outlineMm2: number;
  /** Total area of the holes (mm²). */
  holesMm2: number;
  holeCount: number;
  /** Bounding rectangle area, length × width (mm²). */
  boxMm2: number;
  /** Net area as a % of the bounding rectangle (how much of the blank is real part). */
  fillPct: number;
  /** Cut length: outline + all holes (mm). */
  perimeterMm: number;
  thickness: number;
  /** Net area in m² and weight of one piece (kg). null weight = thickness not entered. */
  netM2: number;
  unitKg: number | null;
  qty: number;
  placed: number;
  left: number;
  totalKg: number | null;
  placedKg: number | null;
  leftKg: number | null;
  /** How the outline / area is worked out for a known shape (typed in, or a plain rectangle / circle); null for a free outline. */
  formula: ShapeFormula | null;
  /** The holes, round ones grouped by diameter. */
  holes: HoleLine[];
}

const shoelace = (p: [number, number][]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    s += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(s / 2);
};

/** Everything the "Details" popup shows for one row of "Parts & quantities". */
export function partDetails(g: Group, placed: number, left: number): PartDetails {
  const holesMm2 = g.holes.reduce((s, h) => s + shoelace(h as [number, number][]), 0);
  const netMm2 = g.area;
  const boxMm2 = g.w * g.h;
  const netM2 = netMm2 / 1e6;
  const th = g.th > 0 ? g.th : 0;
  const unitKg = th > 0 ? netM2 * th * STEEL_KG_PER_M2_MM : null;
  const times = (n: number) => (unitKg === null ? null : unitKg * n);
  return {
    netMm2,
    outlineMm2: netMm2 + holesMm2,
    holesMm2,
    holeCount: g.holes.length,
    boxMm2,
    fillPct: boxMm2 > 0 ? (netMm2 / boxMm2) * 100 : 0,
    perimeterMm: g.per,
    thickness: th,
    netM2,
    unitKg,
    qty: g.qty,
    placed,
    left,
    totalKg: times(g.qty),
    placedKg: times(placed),
    leftKg: times(left),
    formula: shapeFormula(g),
    holes: holeLines(g.holes),
  };
}
