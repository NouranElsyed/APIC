/**
 * Free-form cut lines — geometry kernel.
 *
 * A free cut is an open polyline drawn by the user. It is clipped to the material of a region and
 * splits the region along it. Like the axis-aligned kernel in `geometry.ts` this is exact: arcs
 * stay arcs (the boundary is only subdivided at the crossing points), holes crossed by the line
 * become notches, and a concave shape may give several pieces.
 *
 * Method: the path crosses the boundary of the region an even number of times (it starts and ends
 * outside, see `extendPath`). The parts of the path between crossing 0–1, 2–3, … lie in material
 * and are the CHORDS. Cutting along the chords gives faces that are traced with a simple rule —
 * every crossing has exactly one boundary edge going out, one coming in and one chord, so:
 *   arriving along the boundary  → leave along the chord;
 *   arriving along a chord       → leave along the boundary.
 * Faces keep the material on their left, so outer loops come out counter-clockwise.
 *
 * Degenerate input (the line passes through a vertex, runs along an edge or touches an arc) is moved
 * by a tiny fixed step, the same policy as the axis-aligned cuts (`SplitResult.shifted`). The same
 * shift is used for every region cut by one line, so neighbouring pieces still mate exactly.
 */
import { flattenLoop, loopArea, loopBBox, normalizeRegion, regionArea, ringsContain } from "./geometry";
import type { Edge, Loop, Pt, Region } from "./types";

const TAU = Math.PI * 2;
/** Distance (mm) below which a crossing counts as "at a vertex". */
const EPS = 1e-7;
export const FREE_SHIFT_STEP = 1e-4;
const MAX_TRIES = 5;
/** Shortest distance between two vertices of a drawn cut (mm); closer points are merged. */
export const FREE_MIN_SEGMENT = 1e-3;

class Degenerate extends Error {}

const mod2pi = (v: number) => ((v % TAU) + TAU) % TAU;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/* ------------------------------------------------------------------ */
/* Drawn paths                                                         */
/* ------------------------------------------------------------------ */

export const pathLength = (pts: Pt[]): number => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
};

/** Removes repeated points, then simplifies with Ramer–Douglas–Peucker (max deviation `tol` mm). */
export function simplifyPath(input: Pt[], tol: number): Pt[] {
  const pts: Pt[] = [];
  for (const p of input) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= FREE_MIN_SEGMENT) pts.push([p[0], p[1]]);
  }
  if (pts.length <= 2 || !(tol > 0)) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const dx = pts[j][0] - ax;
    const dy = pts[j][1] - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = len > 0 ? Math.abs(cross(dx, dy, pts[k][0] - ax, pts[k][1] - ay)) / len : Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = true;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function segmentsMeet(p: Pt, q: Pt, r: Pt, s: Pt, adjacent: boolean): boolean {
  const ux = q[0] - p[0];
  const uy = q[1] - p[1];
  const vx = s[0] - r[0];
  const vy = s[1] - r[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return false;
  const parallel = Math.abs(cross(ux, uy, vx, vy)) <= 1e-9 * lu * lv;
  if (adjacent) return parallel && ux * vx + uy * vy < 0; // the line folds back onto itself
  const o = (a: Pt, b: Pt, c: Pt) => cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d1 = o(r, s, p);
  const d2 = o(r, s, q);
  const d3 = o(p, q, r);
  const d4 = o(p, q, s);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: Pt, b: Pt, c: Pt, d: number) =>
    Math.abs(d) <= 1e-9 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1])) &&
    c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    c[1] >= Math.min(a[1], b[1]) - 1e-9 && c[1] <= Math.max(a[1], b[1]) + 1e-9;
  return on(r, s, p, d1) || on(r, s, q, d2) || on(p, q, r, d3) || on(p, q, s, d4);
}

/** True when the polyline crosses or touches itself, or folds back on itself. */
export function pathSelfIntersects(pts: Pt[]): boolean {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segmentsMeet(pts[i], pts[i + 1], pts[j], pts[j + 1], j === i + 1)) return true;
    }
  }
  return false;
}

/**
 * Prolongs both ends of the path by `reach` mm along their last segment, so a line whose ends were
 * drawn inside the part still runs out through the edge. `reach` must exceed the part's size.
 */
export function extendPath(pts: Pt[], reach: number): Pt[] {
  const n = pts.length;
  if (n < 2) return pts.map((p) => [p[0], p[1]] as Pt);
  const ext = (from: Pt, to: Pt): Pt => {
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [to[0] + ((to[0] - from[0]) / d) * reach, to[1] + ((to[1] - from[1]) / d) * reach];
  };
  return [ext(pts[1], pts[0]), ...pts.map((p) => [p[0], p[1]] as Pt), ext(pts[n - 2], pts[n - 1])];
}

/** Distance from `p` to the polyline. */
export function distanceToPath(pts: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const dx = pts[i][0] - ax;
    const dy = pts[i][1] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Crossings                                                           */
/* ------------------------------------------------------------------ */

interface Hit {
  /** Parameter along the boundary edge, 0..1. */
  t: number;
  /** Parameter along the path segment, 0..1. */
  s: number;
  p: Pt;
}

function hitLine(p: Pt, q: Pt, a: Pt, b: Pt): Hit[] {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l1 = Math.hypot(dx, dy);
  const l2 = Math.hypot(ex, ey);
  if (l1 === 0 || l2 === 0) return [];
  const den = cross(dx, dy, ex, ey);
  if (Math.abs(den) <= 1e-12 * l1 * l2) {
    // parallel: only a problem when the two lie on top of each other
    if (Math.abs(cross(a[0] - p[0], a[1] - p[1], dx, dy)) / l1 < EPS) {
      const ta = ((a[0] - p[0]) * dx + (a[1] - p[1]) * dy) / (l1 * l1);
      const tb = ((b[0] - p[0]) * dx + (b[1] - p[1]) * dy) / (l1 * l1);
      if (Math.max(ta, tb) > 0 && Math.min(ta, tb) < 1) throw new Degenerate();
    }
    return [];
  }
  const s = cross(a[0] - p[0], a[1] - p[1], ex, ey) / den;
  const t = cross(a[0] - p[0], a[1] - p[1], dx, dy) / den;
  const sTol = EPS / l1;
  const tTol = EPS / l2;
  if (s < -sTol || s > 1 + sTol || t < -tTol || t > 1 + tTol) return [];
  if (s < sTol || s > 1 - sTol || t < tTol || t > 1 - tTol) throw new Degenerate();
  return [{ t, s, p: [p[0] + s * dx, p[1] + s * dy] }];
}

function hitArc(p: Pt, q: Pt, e: Edge): Hit[] {
  const { c, r, a0, sweep } = e.arc!;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const A = dx * dx + dy * dy;
  if (A === 0) return [];
  const fx = p[0] - c[0];
  const fy = p[1] - c[1];
  const B = fx * dx + fy * dy;
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - A * C;
  if (disc < 0) return [];
  const l1 = Math.sqrt(A);
  const sTol = EPS / l1;
  const half = Math.sqrt(disc) / l1; // half the chord length inside the circle
  if (half < EPS) {
    const s0 = -B / A;
    if (s0 >= -sTol && s0 <= 1 + sTol) throw new Degenerate(); // touches the circle
    return [];
  }
  const span = Math.abs(sweep);
  const angTol = EPS / r;
  const out: Hit[] = [];
  for (const s of [(-B - Math.sqrt(disc)) / A, (-B + Math.sqrt(disc)) / A]) {
    if (s < -sTol || s > 1 + sTol) continue;
    const x = p[0] + s * dx;
    const y = p[1] + s * dy;
    const phi = Math.atan2(y - c[1], x - c[0]);
    let delta = mod2pi(sweep > 0 ? phi - a0 : a0 - phi);
    if (delta > TAU - angTol) delta -= TAU;
    if (delta < -angTol || delta > span + angTol) continue;
    if (s < sTol || s > 1 - sTol || delta < angTol || delta > span - angTol) throw new Degenerate();
    out.push({ t: delta / span, s, p: [x, y] });
  }
  return out;
}

interface Crossing {
  id: number;
  loop: number;
  edge: number;
  t: number;
  p: Pt;
  /** Position along the path: segment index + fraction. */
  s: number;
  /** Index of the path segment it lies on. */
  seg: number;
}

/* ------------------------------------------------------------------ */
/* Splitting                                                           */
/* ------------------------------------------------------------------ */

export interface PathSplit {
  /** Pieces after the cut (sorted bottom-to-top, then left-to-right). One piece = the region was not cut. */
  pieces: Region[];
  /** The cut inside the material: one polyline per chord. These are the seams. */
  chords: Pt[][];
  seamLength: number;
  /** Indices (into the input region's `holes`) of holes the line crosses. */
  holesCrossed: number[];
  /** |Σ area(pieces) − area(region)|; should be ~0. */
  areaError: number;
}

function subEdge(e: Edge, t0: number, t1: number, a: Pt, b: Pt): Edge | null {
  if (t1 - t0 <= 1e-12) return null;
  if (!e.arc) return { a, b };
  const { c, r, a0, sweep } = e.arc;
  return { a, b, arc: { c, r, a0: a0 + sweep * t0, sweep: sweep * (t1 - t0) } };
}

interface Chain {
  startId: number;
  endId: number;
  edges: Edge[];
}

function chordEdges(pts: Pt[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) out.push({ a: pts[i - 1], b: pts[i] });
  return out;
}

const reverseEdges = (edges: Edge[]): Edge[] => edges.slice().reverse().map((e) => ({ a: e.b, b: e.a }));

const bboxOrder = (p: Region, q: Region) => {
  const bp = loopBBox(p.outer);
  const bq = loopBBox(q.outer);
  return bp[1] - bq[1] || bp[0] - bq[0];
};

function assemble(loops: Loop[]): Region[] {
  const outers = loops
    .filter((l) => loopArea(l) > 1e-9)
    .map((outer) => ({ outer, holes: [] as Loop[], ring: flattenLoop(outer, 1e-3), area: loopArea(outer) }));
  for (const hole of loops.filter((l) => loopArea(l) < -1e-9)) {
    const p = hole[0].a;
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) if (ringsContain([o.ring], p) && (!best || o.area < best.area)) best = o;
    if (!best) throw new Degenerate();
    best.holes.push(hole);
  }
  return outers.map((o) => ({ outer: o.outer, holes: o.holes })).sort(bboxOrder);
}

/** One attempt at exactly this path. Throws `Degenerate` when the path hits a vertex/edge. */
function trySplit(region: Region, path: Pt[]): PathSplit {
  const loops: Loop[] = [region.outer, ...region.holes];

  const crossings: Crossing[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i];
    const q = path[i + 1];
    loops.forEach((loop, li) =>
      loop.forEach((e, ei) => {
        const hits = e.arc ? hitArc(p, q, e) : hitLine(p, q, e.a, e.b);
        for (const h of hits) crossings.push({ id: -1, loop: li, edge: ei, t: h.t, p: h.p, s: i + h.s, seg: i });
      }),
    );
  }
  if (crossings.length % 2) throw new Degenerate();
  if (!crossings.length) return { pieces: [region], chords: [], seamLength: 0, holesCrossed: [], areaError: 0 };
  crossings.sort((x, y) => x.s - y.s);
  crossings.forEach((c, i) => (c.id = i));

  // chords: the path between crossing 2k and 2k+1 lies in material
  const chords: Pt[][] = [];
  for (let k = 0; k < crossings.length; k += 2) {
    const a = crossings[k];
    const b = crossings[k + 1];
    const pts: Pt[] = [a.p];
    for (let v = a.seg + 1; v <= b.seg; v++) pts.push(path[v]);
    pts.push(b.p);
    chords.push(pts);
  }
  const rings = loops.map((l) => flattenLoop(l, 1e-3));
  for (const ch of chords) {
    // sanity check against a wrong parity: the middle of the longest piece of every chord must be inside the material
    let bi = 0;
    let bl = -1;
    for (let i = 1; i < ch.length; i++) {
      const l = Math.hypot(ch[i][0] - ch[i - 1][0], ch[i][1] - ch[i - 1][1]);
      if (l > bl) {
        bl = l;
        bi = i;
      }
    }
    const mid: Pt = [(ch[bi][0] + ch[bi - 1][0]) / 2, (ch[bi][1] + ch[bi - 1][1]) / 2];
    if (!ringsContain(rings, mid)) throw new Degenerate();
  }

  // boundary chains between consecutive crossings of each loop
  const chains: Chain[] = [];
  const holesCrossed = new Set<number>();
  const whole: Loop[] = [];
  loops.forEach((loop, li) => {
    const list = crossings.filter((c) => c.loop === li).sort((x, y) => x.edge + x.t - (y.edge + y.t));
    if (!list.length) {
      if (li > 0) whole.push(loop);
      return;
    }
    if (li > 0) holesCrossed.add(li - 1);
    const N = loop.length;
    list.forEach((from, j) => {
      const to = list[(j + 1) % list.length];
      const u0 = from.edge + from.t;
      let u1 = to.edge + to.t;
      if (list.length === 1 || u1 <= u0) u1 += N;
      const edges: Edge[] = [];
      let cur = u0;
      let first = true;
      while (cur < u1 - 1e-12) {
        const base = Math.floor(cur + 1e-12);
        const ei = base % N;
        const e = loop[ei];
        const endU = Math.min(base + 1, u1);
        const last = endU >= u1 - 1e-12;
        const se = subEdge(e, Math.max(0, cur - base), endU - base, first ? from.p : e.a, last ? to.p : e.b);
        if (se) edges.push(se);
        cur = endU;
        first = false;
      }
      if (!edges.length) throw new Degenerate();
      chains.push({ startId: from.id, endId: to.id, edges });
    });
  });

  // chord leaving each crossing
  const chordOut = new Map<number, { to: number; edges: Edge[] }>();
  chords.forEach((ch, k) => {
    const a = crossings[2 * k].id;
    const b = crossings[2 * k + 1].id;
    const fwd = chordEdges(ch);
    chordOut.set(a, { to: b, edges: fwd });
    chordOut.set(b, { to: a, edges: reverseEdges(fwd) });
  });
  const chainFrom = new Map(chains.map((c) => [c.startId, c]));

  const faces: Loop[] = [];
  const seen = new Set<Chain>();
  for (const first of chains) {
    if (seen.has(first)) continue;
    const face: Loop = [];
    let cur = first;
    do {
      seen.add(cur);
      face.push(...cur.edges);
      const out = chordOut.get(cur.endId);
      const next = out && chainFrom.get(out.to);
      if (!out || !next || (seen.has(next) && next !== first)) throw new Degenerate();
      face.push(...out.edges);
      cur = next;
    } while (cur !== first);
    faces.push(face);
  }

  const pieces = assemble([...faces, ...whole]);
  const sum = pieces.reduce((t, r) => t + regionArea(r), 0);
  return {
    pieces,
    chords,
    seamLength: chords.reduce((t, ch) => t + pathLength(ch), 0),
    holesCrossed: [...holesCrossed].sort((a, b) => a - b),
    areaError: Math.abs(sum - regionArea(region)),
  };
}

export interface PathSplitAll {
  /** One result per input region, in the same order. */
  parts: PathSplit[];
  /** The path actually used (shifted by a tiny step when the requested one was degenerate). */
  usedPath: Pt[];
  shifted: boolean;
}

/**
 * Cuts every region along the path. The path must start and end OUTSIDE all of them (use
 * `extendPath` with a reach larger than the part). One shift is chosen for all regions.
 */
export function splitRegionsByPath(regionsIn: Region[], path: Pt[]): PathSplitAll {
  if (path.length < 2) throw new Error("segmentation: a free cut needs at least two points");
  const regions = regionsIn.map(normalizeRegion);
  for (const r of regions) {
    const ring = [flattenLoop(r.outer, 1e-3)];
    if (ringsContain(ring, path[0]) || ringsContain(ring, path[path.length - 1])) {
      throw new Error("segmentation: a free cut must start and end outside the part (extend the path first)");
    }
  }
  for (let k = 0; k <= MAX_TRIES; k++) {
    const used: Pt[] = k === 0 ? path : path.map((p) => [p[0] + k * FREE_SHIFT_STEP, p[1] + k * FREE_SHIFT_STEP * 0.618] as Pt);
    try {
      return { parts: regions.map((r) => trySplit(r, used)), usedPath: used, shifted: k > 0 };
    } catch (e) {
      if (!(e instanceof Degenerate)) throw e;
    }
  }
  throw new Error("segmentation: could not find a non-degenerate position for the free cut");
}

/** Cuts one region along the path (see `splitRegionsByPath`). */
export function splitRegionByPath(region: Region, path: Pt[]): PathSplit & { usedPath: Pt[]; shifted: boolean } {
  const r = splitRegionsByPath([region], path);
  return { ...r.parts[0], usedPath: r.usedPath, shifted: r.shifted };
}

/* ------------------------------------------------------------------ */
/* Seams between pieces                                                */
/* ------------------------------------------------------------------ */

/**
 * The straight boundary the two regions share (collinear, overlapping edges), as segments.
 * Used to find the seams between pieces made by free cuts.
 */
export function sharedSegments(a: Region, b: Region, tol = 1e-6): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  const edgesOf = (r: Region) => [r.outer, ...r.holes].flat().filter((e) => !e.arc);
  const eb = edgesOf(b);
  for (const e of edgesOf(a)) {
    const ux = e.b[0] - e.a[0];
    const uy = e.b[1] - e.a[1];
    const len = Math.hypot(ux, uy);
    if (len < tol) continue;
    for (const f of eb) {
      const da = Math.abs(cross(ux, uy, f.a[0] - e.a[0], f.a[1] - e.a[1])) / len;
      const db = Math.abs(cross(ux, uy, f.b[0] - e.a[0], f.b[1] - e.a[1])) / len;
      if (da > tol || db > tol) continue;
      const ta = ((f.a[0] - e.a[0]) * ux + (f.a[1] - e.a[1]) * uy) / (len * len);
      const tb = ((f.b[0] - e.a[0]) * ux + (f.b[1] - e.a[1]) * uy) / (len * len);
      const lo = Math.max(0, Math.min(ta, tb));
      const hi = Math.min(1, Math.max(ta, tb));
      if ((hi - lo) * len > 1e-6) out.push([[e.a[0] + ux * lo, e.a[1] + uy * lo], [e.a[0] + ux * hi, e.a[1] + uy * hi]]);
    }
  }
  return out;
}

export const segmentLength = (s: [Pt, Pt]) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
