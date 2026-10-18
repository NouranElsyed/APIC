/**
 * Region → engine `Group` shape.
 *
 * The nesting engine works on polygons whose bounding box starts at (0,0), with
 * `area` = outer − holes and `per` = outer + holes perimeters (see `extractParts` in
 * nest-boost/engine.ts). This follows the same conventions so a segment converted here
 * behaves exactly like an imported part.
 */
import { flattenLoop, regionArea } from "./geometry";
import type { Pt, Region } from "./types";

export interface GroupShape {
  outer: Pt[];
  holes: Pt[][];
  /** Bounding-box size of the polygon (arc extremes are included, so it equals the true size). */
  w: number;
  h: number;
  /** Polygon area (outer − holes), same convention as the engine. */
  area: number;
  /** Polygon perimeter (outer + holes), same convention as the engine. */
  per: number;
  /** Exact area from the arcs/lines, for reporting. */
  exactArea: number;
  /** Where the polygon's (0,0) sits in the region's own coordinates. */
  origin: Pt;
}

const polyArea = (pts: Pt[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += (x1 * y2 - x2 * y1) / 2;
  }
  return Math.abs(a);
};
const polyPer = (pts: Pt[]) => pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]), 0);

/** Tessellates arcs to `tol` mm (chord deviation) and moves the outline to the origin. */
export function regionToGroupShape(region: Region, tol = 0.1): GroupShape {
  const outer = flattenLoop(region.outer, tol, { extremes: true });
  const holes = region.holes.map((h) => flattenLoop(h, tol, { extremes: true }));
  const mx = Math.min(...outer.map((p) => p[0]));
  const my = Math.min(...outer.map((p) => p[1]));
  const mv = (r: Pt[]) => r.map((p) => [p[0] - mx, p[1] - my] as Pt);
  const o = mv(outer);
  const hs = holes.map(mv);
  return {
    outer: o,
    holes: hs,
    w: Math.max(...o.map((p) => p[0])),
    h: Math.max(...o.map((p) => p[1])),
    area: polyArea(o) - hs.reduce((s, h) => s + polyArea(h), 0),
    per: polyPer(o) + hs.reduce((s, h) => s + polyPer(h), 0),
    exactArea: regionArea(region),
    origin: [mx, my],
  };
}
