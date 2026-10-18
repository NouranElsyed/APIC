/**
 * Group → Region, with arcs rebuilt.
 *
 * Nest Boost stores parts as polygons: its DXF importer (`arcPts` in nest-boost/engine.ts)
 * flattens every CIRCLE / ARC / bulge into vertices that lie EXACTLY on the original circle,
 * at equal angular steps of at most 5° (manual circles use even smaller steps). That is a very
 * specific signature, so the arcs can be rebuilt exactly from the polygon — no change to the
 * importer, no change to stored parts.
 *
 * A run of ≥ 4 consecutive vertices is rebuilt as one arc only if ALL of these hold:
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

/** Least-squares circle through `pts` (Kahan/Kåsa fit on centred coordinates), or null if degenerate. */
function fitCircle(pts: Pt[]): { cx: number; cy: number; r: number } | null {
  const N = pts.length;
  if (N < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= N;
  my /= N;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx;
    const v = p[1] - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12 * Math.max(1, suu * svv)) return null;
  const b1 = (suuu + suvv) / 2;
  const b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det;
  const vc = (b2 * suu - b1 * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / N);
  if (!Number.isFinite(r)) return null;
  return { cx: mx + uc, cy: my + vc, r };
}

/**
 * Checks that `pts` (consecutive vertices) lie on one circle within `tol` and are spaced at equal
 * angular steps (≤ 5°). Returns the circle with its signed step, or null.
 */
function arcThrough(pts: Pt[], tol: number, cyclic = false): Circ | null {
  const c = fitCircle(pts);
  if (!c || !(c.r > 10 * tol) || c.r > 1e6) return null;
  if (pts.some((p) => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) > tol)) return null;
  const ang = pts.map((p) => Math.atan2(p[1] - c.cy, p[0] - c.cx));
  const steps: number[] = [];
  const m = cyclic ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) steps.push(wrap(ang[(i + 1) % pts.length] - ang[i]));
  const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
  if (Math.abs(mean) < 1e-9 || Math.abs(mean) > MAX_ARC_STEP) return null;
  const slack = 1e-6 + 2e-3 * Math.abs(mean) + (2 * tol) / c.r;
  if (steps.some((v) => Math.sign(v) !== Math.sign(mean) || Math.abs(v - mean) > slack)) return null;
  if (cyclic && Math.abs(Math.abs(mean) * steps.length - TAU) > 1e-2) return null;
  return { ...c, step: mean };
}

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

  // Turning angle at every vertex, from chord directions (stable against tiny coordinate noise,
  // unlike a circle through three noisy points). On a tessellated arc it equals the angular step.
  const chord = (P: Pt[], i: number): Pt => [P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]];
  const turnsOf = (P: Pt[]) =>
    P.map((_, i) => {
      const d0 = chord(P, (i - 1 + n) % n);
      const d1 = chord(P, i);
      return { t: wrap(Math.atan2(d1[1], d1[0]) - Math.atan2(d0[1], d0[0])), len: Math.min(Math.hypot(d0[0], d0[1]), Math.hypot(d1[0], d1[1])) };
    });
  const turnLinks = (P: Pt[]) => {
    const T = turnsOf(P);
    const valid = (i: number) => Math.abs(T[i].t) >= 1e-9 && Math.abs(T[i].t) <= MAX_ARC_STEP;
    // link(i): vertices i and i+1 continue the same arc (same sign, equal turning angle)
    const link = (i: number) => {
      const a = T[((i % n) + n) % n];
      const b = T[(((i + 1) % n) + n) % n];
      if (!valid(((i % n) + n) % n) || !valid((((i + 1) % n) + n) % n)) return false;
      if (Math.sign(a.t) !== Math.sign(b.t)) return false;
      // equal angular steps on one circle also mean equal chords (this rejects an arc's 2.5° end
      // vertex being "linked" across a long straight edge to the next arc's end vertex)
      const k = ((i % n) + n) % n;
      const ch = [(k - 1 + n) % n, k, (k + 1) % n].map((q) => Math.hypot(...chord(P, q)));
      if (Math.max(...ch) - Math.min(...ch) > 2e-3 * Math.max(...ch) + 4 * tol) return false;
      const minLen = Math.max(1e-9, Math.min(a.len, b.len));
      return Math.abs(a.t - b.t) <= 1e-6 + 1e-3 * Math.abs(a.t) + (4 * tol) / minLen;
    };
    return { valid, link };
  };

  // whole loop is one circle?
  {
    const { link } = turnLinks(pts);
    if (pts.every((_, i) => link(i))) {
      const c = arcThrough(pts, tol, true);
      if (c) return { loop: circleLoop(c.cx, c.cy, c.r, c.step > 0), arcs: 2, circle: true };
    }
  }

  // rotate so vertex 0 starts a run or is not on an arc
  const L0 = turnLinks(pts);
  let first = pts.findIndex((_, i) => !L0.valid(i) || !L0.link(i - 1));
  if (first < 0) first = 0;
  const P = pts.map((_, i) => pts[(i + first) % n]);
  const { valid, link: cp } = turnLinks(P);

  interface Arc {
    s: number; // start vertex
    segs: number; // number of segments covered
    circ: Circ;
  }
  const arcs: Arc[] = [];
  let owned = -1; // last edge index used by an arc
  for (let i = 0; i < n; ) {
    if (!valid(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && cp(j)) j++;
    // run of valid vertices i..j covers vertices i-1 .. j+1 → edges i-1 .. j
    const startEdge = Math.max(i - 1, owned + 1);
    const endEdge = j; // edge j goes from vertex j to j+1
    const segs = endEdge - startEdge + 1;
    if (segs >= 3 && startEdge >= 0) { // ≥ 4 vertices: three points always lie on some circle, four must really agree
      const run = Array.from({ length: segs + 1 }, (_, k) => P[(startEdge + k) % n]);
      const c = arcThrough(run, tol);
      if (c) {
        arcs.push({ s: startEdge, segs, circ: c });
        owned = endEdge;
      }
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
