/**
 * Group → Region, with arcs rebuilt.
 *
 * Nest Boost stores parts as polygons: its DXF importer (`arcPts` in nest-boost/engine.ts)
 * flattens every CIRCLE / ARC / bulge into vertices that lie EXACTLY on the original circle,
 * at equal angular steps of at most 5° (manual circles use even smaller steps). That is a very
 * specific signature, so the arcs can be rebuilt exactly from the polygon — no change to the
 * importer, no change to stored parts.
 *
 * A run of ≥ 3 consecutive vertices is rebuilt as one arc only if ALL of these hold:
 *   - they are co-circular (centre and radius agree within `tol`, default 0.001 mm),
 *   - the angular step between neighbours is equal (relative 0.1 %) and ≤ 5°.
 * Hexagons, rectangles, free polylines, etc. never match (their steps are large or unequal).
 * Known limitation: a polygon drawn with LINEs whose vertices sit exactly on a circle at
 * equal ≤ 5° steps is indistinguishable from a tessellated circle and is rebuilt as one.
 *
 * Arc end points are snapped onto the fitted circle (shift ≤ `tol`), and the adjoining line
 * edges follow, so the loop stays closed.
 */
import type { Group, Pt } from "../nest-boost/engine";
import { circleLoop, normalizeRegion, polygonLoop } from "./geometry";
import type { Edge, Loop, Region } from "./types";

const TAU = Math.PI * 2;
export const MAX_ARC_STEP = (5 * Math.PI) / 180 + 1e-4; // the importer's step is ≤ 5°
export const DEFAULT_ARC_TOL = 1e-3;

interface Circ {
  cx: number;
  cy: number;
  r: number;
  /** Signed angular step between neighbouring vertices (radians, + = counter-clockwise). */
  step: number;
}

const wrap = (a: number) => {
  let v = a % TAU;
  if (v > Math.PI) v -= TAU;
  else if (v <= -Math.PI) v += TAU;
  return v;
};

/** Circle through three points, with the angular steps a→b and b→c, or null if unusable. */
function circleThrough(a: Pt, b: Pt, c: Pt, tol: number): Circ | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  if (!(r > 10 * tol) || r > 1e6) return null;
  const s1 = wrap(Math.atan2(b[1] - cy, b[0] - cx) - Math.atan2(a[1] - cy, a[0] - cx));
  const s2 = wrap(Math.atan2(c[1] - cy, c[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  if (Math.abs(s1) > MAX_ARC_STEP || Math.abs(s2) > MAX_ARC_STEP || Math.abs(s1) < 1e-9) return null;
  if (Math.abs(s1 - s2) > 1e-6 + 1e-3 * Math.abs(s1)) return null;
  return { cx, cy, r, step: (s1 + s2) / 2 };
}

const same = (p: Circ, q: Circ, tol: number) =>
  Math.hypot(p.cx - q.cx, p.cy - q.cy) <= tol &&
  Math.abs(p.r - q.r) <= tol &&
  Math.abs(p.step - q.step) <= 1e-6 + 1e-3 * Math.abs(p.step);

export interface RecoveredLoop {
  loop: Loop;
  /** Number of arc edges in the loop (a full circle counts as 2 half arcs). */
  arcs: number;
  /** True when the whole loop is one circle. */
  circle: boolean;
}

/** Polygon (closed, no repeated first point) → loop of lines and exact arcs. */
export function recoverArcs(pts: Pt[], opts: { tol?: number } = {}): RecoveredLoop {
  const tol = opts.tol ?? DEFAULT_ARC_TOL;
  const n = pts.length;
  const polygon = (): RecoveredLoop => ({ loop: polygonLoop(pts), arcs: 0, circle: false });
  if (n < 4) return polygon();

  const at = (i: number) => pts[((i % n) + n) % n];
  const circ: (Circ | null)[] = pts.map((_, i) => circleThrough(at(i - 1), at(i), at(i + 1), tol));
  const compat = (i: number) => {
    const p = circ[((i % n) + n) % n];
    const q = circ[(((i + 1) % n) + n) % n];
    return !!p && !!q && same(p, q, tol);
  };

  // whole loop is one circle?
  if (circ.every((c) => c) && pts.every((_, i) => compat(i))) {
    const c = circ[0]!;
    return { loop: circleLoop(c.cx, c.cy, c.r, c.step > 0), arcs: 2, circle: true };
  }

  // rotate so vertex 0 starts a run or is not on an arc
  let first = circ.findIndex((c, i) => !c || !compat(i - 1));
  if (first < 0) first = 0;
  const P = pts.map((_, i) => pts[(i + first) % n]);
  const C = circ.map((_, i) => circ[(i + first) % n]);
  const cp = (i: number) => {
    const p = C[i];
    const q = C[(i + 1) % n];
    return !!p && !!q && same(p, q, tol);
  };

  interface Arc {
    s: number; // start vertex
    segs: number; // number of segments covered
    circ: Circ;
  }
  const arcs: Arc[] = [];
  let owned = -1; // last edge index used by an arc
  for (let i = 0; i < n; ) {
    const c = C[i];
    if (!c) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && cp(j)) j++;
    // run of valid vertices i..j covers vertices i-1 .. j+1 → edges i-1 .. j
    const startEdge = Math.max(i - 1, owned + 1);
    const endEdge = j; // edge j goes from vertex j to j+1
    const segs = endEdge - startEdge + 1;
    if (segs >= 2 && startEdge >= 0) {
      arcs.push({ s: startEdge, segs, circ: c });
      owned = endEdge;
    }
    i = j + 1;
  }
  if (!arcs.length) return polygon();

  // snap arc end vertices onto their circle (the neighbouring lines follow)
  const V: Pt[] = P.map((p) => [p[0], p[1]] as Pt);
  const endpoint = new Map<number, number>(); // vertex -> number of arcs ending/starting there
  for (const a of arcs) {
    for (const v of [a.s, (a.s + a.segs) % n]) endpoint.set(v, (endpoint.get(v) ?? 0) + 1);
  }
  for (const a of arcs) {
    for (const v of [a.s, (a.s + a.segs) % n]) {
      if (endpoint.get(v) !== 1) continue; // shared by two different circles: keep as is
      const ang = Math.atan2(V[v][1] - a.circ.cy, V[v][0] - a.circ.cx);
      V[v] = [a.circ.cx + a.circ.r * Math.cos(ang), a.circ.cy + a.circ.r * Math.sin(ang)];
    }
  }

  const arcAt = new Map(arcs.map((a) => [a.s, a]));
  const interior = new Set<number>();
  for (const a of arcs) for (let k = 1; k < a.segs; k++) interior.add((a.s + k) % n);

  const edges: Edge[] = [];
  let i = 0;
  while (i < n) {
    const a = arcAt.get(i);
    if (a) {
      const e = (i + a.segs) % n;
      edges.push({
        a: V[i],
        b: V[e],
        arc: { c: [a.circ.cx, a.circ.cy], r: a.circ.r, a0: Math.atan2(V[i][1] - a.circ.cy, V[i][0] - a.circ.cx), sweep: a.circ.step * a.segs },
      });
      i += a.segs;
    } else {
      edges.push({ a: V[i], b: V[(i + 1) % n] });
      i++;
    }
  }
  // vertex 0 is never interior to an arc by construction of the rotation
  return { loop: edges, arcs: arcs.length, circle: false };
}

export interface GroupRegion {
  region: Region;
  /** Arc edges rebuilt over all loops (a circle counts as 2). */
  arcs: number;
  /** "arcs": at least one arc was rebuilt exactly; "polygon": the outline is used as imported. */
  fidelity: "arcs" | "polygon";
}

/** Region of a nest part. Rings in `extra` (auto-paired triangles) are not part of the shape. */
export function groupToRegion(g: Pick<Group, "outer" | "holes">, opts: { recoverArcs?: boolean; tol?: number } = {}): GroupRegion {
  const rebuild = opts.recoverArcs ?? true;
  const conv = (ring: Pt[]): RecoveredLoop =>
    rebuild ? recoverArcs(ring, { tol: opts.tol }) : { loop: polygonLoop(ring), arcs: 0, circle: false };
  const outer = conv(g.outer);
  const holes = g.holes.map(conv);
  const arcs = outer.arcs + holes.reduce((s, h) => s + h.arcs, 0);
  return {
    region: normalizeRegion({ outer: outer.loop, holes: holes.map((h) => h.loop) }),
    arcs,
    fidelity: arcs > 0 ? "arcs" : "polygon",
  };
}
