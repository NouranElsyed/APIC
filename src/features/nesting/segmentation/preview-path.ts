/**
 * SVG helpers for the segmentation preview. Arcs are drawn as true SVG arcs, so what the
 * user sees is the exact geometry, not a polygon.
 *
 * Draw the paths inside `<g transform="scale(1,-1)">` (world y points up) and use
 * `svgViewBox` for the viewBox; put text outside that group at (x, -y).
 */
import { regionBBox } from "./geometry";
import type { PlanSeam } from "./planner";
import type { Loop, Region } from "./types";

const TAU = Math.PI * 2;
const f = (v: number) => String(Math.round(v * 1000) / 1000);

/** One closed loop as an SVG path. A full circle edge is drawn as two half arcs. */
export function loopPath(loop: Loop): string {
  let d = `M${f(loop[0].a[0])} ${f(loop[0].a[1])}`;
  for (const e of loop) {
    if (!e.arc) {
      d += `L${f(e.b[0])} ${f(e.b[1])}`;
      continue;
    }
    const { c, r, a0, sweep } = e.arc;
    const sf = sweep > 0 ? 1 : 0;
    if (Math.abs(sweep) >= TAU - 1e-9) {
      const mid = a0 + sweep / 2;
      d += `A${f(r)} ${f(r)} 0 0 ${sf} ${f(c[0] + r * Math.cos(mid))} ${f(c[1] + r * Math.sin(mid))}`;
      d += `A${f(r)} ${f(r)} 0 0 ${sf} ${f(e.b[0])} ${f(e.b[1])}`;
    } else {
      d += `A${f(r)} ${f(r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sf} ${f(e.b[0])} ${f(e.b[1])}`;
    }
  }
  return `${d}Z`;
}

/** Outer loop plus holes; use with `fillRule="evenodd"`. */
export const regionPath = (region: Region): string => [region.outer, ...region.holes].map(loopPath).join("");

/** viewBox string for a y-flipped drawing of `region`, with a margin (fraction of the larger side). */
export function svgViewBox(region: Region, pad = 0.06): { box: string; size: number } {
  const [x0, y0, x1, y1] = regionBBox(region);
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const p = size * pad;
  return { box: `${f(x0 - p)} ${f(-(y1 + p))} ${f(x1 - x0 + 2 * p)} ${f(y1 - y0 + 2 * p)}`, size };
}

/** The drawn pieces of a seam as line segments in world coordinates. */
export function seamLines(seam: Pick<PlanSeam, "axis" | "pos" | "intervals">): { x1: number; y1: number; x2: number; y2: number }[] {
  return seam.intervals.map(([lo, hi]) =>
    seam.axis === "x" ? { x1: seam.pos, y1: lo, x2: seam.pos, y2: hi } : { x1: lo, y1: seam.pos, x2: hi, y2: seam.pos },
  );
}

/** Translucent fill and solid stroke for segment number `i` (distinct hues, works on light and dark). */
export const segmentFill = (i: number) => `hsl(${(i * 47) % 360} 70% 55% / 0.32)`;
export const segmentStroke = (i: number) => `hsl(${(i * 47) % 360} 65% 42%)`;
