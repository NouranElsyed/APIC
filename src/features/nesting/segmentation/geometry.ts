/**
 * Segmentation geometry kernel (Phase 1).
 *
 * Pure functions, no dependencies. Cuts a region (outer loop + holes, made of
 * lines and circular arcs) with an axis-aligned line and returns the exact pieces
 * on each side — arcs stay arcs, holes crossed by the line become notches,
 * concave shapes may yield several disconnected pieces.
 */
import type {
  Axis,
  CutRecord,
  Edge,
  Loop,
  Pt,
  Region,
  Seam,
  SliceResult,
  SplitOptions,
  SplitResult,
} from "./types";

const TAU = Math.PI * 2;
export const DEFAULT_EPS = 1e-6;
/** Step used to move a degenerate cut line (see SplitResult.shifted). */
export const SHIFT_STEP = 1e-4;
const MAX_SHIFT_TRIES = 5;
/** Minimum distance between two cut positions given to `sliceRegion`. */
export const MIN_CUT_SPACING = 1e-3;

type AxisIdx = 0 | 1;
const axisIndex = (axis: Axis): AxisIdx => (axis === "x" ? 0 : 1);
const mod2pi = (v: number) => ((v % TAU) + TAU) % TAU;

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/** Closed polygon loop. Drops repeated points and a duplicated closing point. */
export function polygonLoop(points: Pt[]): Loop {
  const pts: Pt[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push([p[0], p[1]]);
  }
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
  }
  if (pts.length < 3) throw new Error("polygonLoop: need at least 3 distinct points");
  return pts.map((p, i) => ({ a: p, b: pts[(i + 1) % pts.length] }));
}

/**
 * Closed loop from DXF-style LWPOLYLINE vertices `[x, y, bulge]`.
 * `bulge = tan(sweep / 4)`; positive = counter-clockwise arc to the next vertex.
 */
export function loopFromBulge(verts: [number, number, number][]): Loop {
  const n = verts.length;
  if (n < 2) throw new Error("loopFromBulge: need at least 2 vertices");
  const loop: Loop = [];
  for (let i = 0; i < n; i++) {
    const [x, y, bulge] = verts[i];
    const [qx, qy] = verts[(i + 1) % n];
    const a: Pt = [x, y];
    const b: Pt = [qx, qy];
    if (Math.abs(bulge) < 1e-12) {
      loop.push({ a, b });
      continue;
    }
    const dx = qx - x;
    const dy = qy - y;
    const d = Math.hypot(dx, dy);
    if (d === 0) throw new Error("loopFromBulge: zero-length arc");
    const sweep = 4 * Math.atan(bulge);
    const r = d / (2 * Math.sin(Math.abs(sweep) / 2));
    // signed distance from chord midpoint to the centre, measured to the LEFT of a→b
    const off = Math.sign(sweep) * r * Math.cos(sweep / 2);
    const c: Pt = [(x + qx) / 2 + (-dy / d) * off, (y + qy) / 2 + (dx / d) * off];
    loop.push({ a, b, arc: { c, r, a0: Math.atan2(y - c[1], x - c[0]), sweep } });
  }
  return loop;
}

/** Circle as two half arcs (counter-clockwise unless `ccw` is false). */
export function circleLoop(cx: number, cy: number, r: number, ccw = true): Loop {
  if (!(r > 0)) throw new Error("circleLoop: radius must be > 0");
  const s = ccw ? 1 : -1;
  const east: Pt = [cx + r, cy];
  const west: Pt = [cx - r, cy];
  return [
    { a: east, b: west, arc: { c: [cx, cy], r, a0: 0, sweep: s * Math.PI } },
    { a: west, b: east, arc: { c: [cx, cy], r, a0: Math.PI, sweep: s * Math.PI } },
  ];
}

export function reverseLoop(loop: Loop): Loop {
  return loop
    .slice()
    .reverse()
    .map((e) => {
      const rev: Edge = { a: e.b, b: e.a };
      if (e.arc) rev.arc = { c: e.arc.c, r: e.arc.r, a0: e.arc.a0 + e.arc.sweep, sweep: -e.arc.sweep };
      return rev;
    });
}

/** Region from polygons; fixes orientation (outer CCW, holes CW). */
export function regionFromPolygon(outer: Pt[], holes: Pt[][] = []): Region {
  return normalizeRegion({ outer: polygonLoop(outer), holes: holes.map(polygonLoop) });
}

/** Returns the region with outer CCW and holes CW (same object if already so). */
export function normalizeRegion(region: Region): Region {
  const outerOk = loopArea(region.outer) > 0;
  const holesOk = region.holes.every((h) => loopArea(h) < 0);
  if (outerOk && holesOk) return region;
  return {
    outer: outerOk ? region.outer : reverseLoop(region.outer),
    holes: region.holes.map((h) => (loopArea(h) < 0 ? h : reverseLoop(h))),
  };
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

/** Signed area (CCW positive). Arcs are integrated exactly. */
export function loopArea(loop: Loop): number {
  let s = 0;
  for (const e of loop) {
    s += (e.a[0] * e.b[1] - e.b[0] * e.a[1]) / 2;
    if (e.arc) s += ((e.arc.r * e.arc.r) / 2) * (e.arc.sweep - Math.sin(e.arc.sweep));
  }
  return s;
}

/** Material area: outer minus holes (holes are CW so their signed area is negative). */
export function regionArea(region: Region): number {
  const n = normalizeRegion(region);
  return loopArea(n.outer) + n.holes.reduce((s, h) => s + loopArea(h), 0);
}

export function edgeLength(e: Edge): number {
  return e.arc ? e.arc.r * Math.abs(e.arc.sweep) : Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
}

export function loopLength(loop: Loop): number {
  return loop.reduce((s, e) => s + edgeLength(e), 0);
}

/** Exact bounding box [minX, minY, maxX, maxY] (arc extremes included). */
export function loopBBox(loop: Loop): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const e of loop) {
    add(e.a[0], e.a[1]);
    add(e.b[0], e.b[1]);
    if (e.arc) {
      const { c, r, a0, sweep } = e.arc;
      for (const phi of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const delta = mod2pi(sweep > 0 ? phi - a0 : a0 - phi);
        if (delta < Math.abs(sweep)) add(c[0] + r * Math.cos(phi), c[1] + r * Math.sin(phi));
      }
    }
  }
  return [x0, y0, x1, y1];
}

export const regionBBox = (region: Region) => loopBBox(region.outer);

/* ------------------------------------------------------------------ */
/* Tessellation and point queries (for the nesting engine / validation) */
/* ------------------------------------------------------------------ */

/** Polygon vertices of a loop; arcs are flattened so the chord deviation is ≤ `tol`. */
export function flattenLoop(loop: Loop, tol: number, opts: { extremes?: boolean } = {}): Pt[] {
  const out: Pt[] = [];
  for (const e of loop) {
    out.push([e.a[0], e.a[1]]);
    if (e.arc) {
      const { c, r, a0, sweep } = e.arc;
      const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
      const n = Math.min(100000, Math.max(2, Math.ceil(Math.abs(sweep) / Math.min(step, Math.PI / 2))));
      const angs: number[] = [];
      for (let i = 1; i < n; i++) angs.push(a0 + (sweep * i) / n);
      if (opts.extremes) {
        // add the arc's leftmost/rightmost/lowest/highest points so the polygon's bounding box is exact
        for (const phi of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const delta = mod2pi(sweep > 0 ? phi - a0 : a0 - phi);
          if (delta > 1e-9 && delta < Math.abs(sweep) - 1e-9) angs.push(a0 + Math.sign(sweep) * delta);
        }
        angs.sort((p, q) => (sweep > 0 ? p - q : q - p));
      }
      for (const ang of angs) out.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    }
  }
  return out;
}

/** Region as polygons, in the shape the existing engine's `Group` uses (outer + holes). */
export function regionToPolygon(region: Region, tol: number): { outer: Pt[]; holes: Pt[][] } {
  return { outer: flattenLoop(region.outer, tol), holes: region.holes.map((h) => flattenLoop(h, tol)) };
}

export const regionRings = (region: Region, tol = 1e-3): Pt[][] =>
  [region.outer, ...region.holes].map((l) => flattenLoop(l, tol));

/** Even-odd containment against pre-flattened rings. */
export function ringsContain(rings: Pt[][], p: Pt): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Minimum distance from `p` to the boundary of pre-flattened rings. */
export function ringsDistance(rings: Pt[][], p: Pt): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

export const regionContains = (region: Region, p: Pt, tol = 1e-3) => ringsContain(regionRings(region, tol), p);

/* ------------------------------------------------------------------ */
/* Cutting                                                             */
/* ------------------------------------------------------------------ */

interface Sub {
  edge: Edge;
  side: -1 | 1;
}
interface Chain {
  startId: number;
  endId: number;
  edges: Edge[];
}
interface Chord {
  end: number;
  edge: Edge;
}

/** Parameters t ∈ (0,1) where an arc crosses the line coord[ai] = c, ascending. */
function arcCrossings(e: Edge, ai: AxisIdx, c: number): number[] {
  const arc = e.arc!;
  const k = (c - arc.c[ai]) / arc.r;
  if (k <= -1 || k >= 1) return [];
  const phis = ai === 0 ? [Math.acos(k), -Math.acos(k)] : [Math.asin(k), Math.PI - Math.asin(k)];
  const span = Math.abs(arc.sweep);
  const ts: number[] = [];
  for (const phi of phis) {
    const delta = mod2pi(arc.sweep > 0 ? phi - arc.a0 : arc.a0 - phi);
    if (delta > 0 && delta < span) ts.push(delta / span);
  }
  return ts.sort((p, q) => p - q);
}

/** True if the line passes within `eps` of a vertex or touches an arc tangentially. */
function isDegenerate(region: Region, ai: AxisIdx, c: number, eps: number): boolean {
  for (const loop of [region.outer, ...region.holes]) {
    for (const e of loop) {
      if (Math.abs(e.a[ai] - c) < eps) return true;
      if (e.arc) {
        const { c: cc, r, a0, sweep } = e.arc;
        for (const phi of ai === 0 ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2]) {
          const delta = mod2pi(sweep > 0 ? phi - a0 : a0 - phi);
          if (delta < Math.abs(sweep)) {
            const v = ai === 0 ? cc[0] + r * Math.cos(phi) : cc[1] + r * Math.sin(phi);
            if (Math.abs(v - c) < eps) return true;
          }
        }
      }
    }
  }
  return false;
}

/** Split one edge at the line; every sub-edge lies strictly on one side. */
function subdivide(e: Edge, ai: AxisIdx, c: number): Sub[] {
  const sa = (e.a[ai] - c < 0 ? -1 : 1) as -1 | 1;
  const sb = (e.b[ai] - c < 0 ? -1 : 1) as -1 | 1;
  if (!e.arc) {
    if (sa === sb) return [{ edge: e, side: sa }];
    const t = (e.a[ai] - c) / (e.a[ai] - e.b[ai]);
    const p: Pt = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
    p[ai] = c;
    return [
      { edge: { a: e.a, b: p }, side: sa },
      { edge: { a: p, b: e.b }, side: sb },
    ];
  }
  const ts = arcCrossings(e, ai, c);
  if (!ts.length) {
    if (sa !== sb && Math.abs(e.arc.sweep) < TAU - 1e-9) throw new Error("segmentation: inconsistent arc crossing");
    return [{ edge: e, side: sa }];
  }
  const arc = e.arc;
  const pts: Pt[] = [e.a];
  for (const t of ts) {
    const ang = arc.a0 + arc.sweep * t;
    const p: Pt = [arc.c[0] + arc.r * Math.cos(ang), arc.c[1] + arc.r * Math.sin(ang)];
    p[ai] = c;
    pts.push(p);
  }
  pts.push(e.b);
  const bounds = [0, ...ts, 1];
  const subs: Sub[] = [];
  let side = sa;
  for (let i = 0; i < bounds.length - 1; i++) {
    subs.push({
      edge: {
        a: pts[i],
        b: pts[i + 1],
        arc: { c: arc.c, r: arc.r, a0: arc.a0 + arc.sweep * bounds[i], sweep: arc.sweep * (bounds[i + 1] - bounds[i]) },
      },
      side,
    });
    side = (-side) as -1 | 1;
  }
  if (subs[subs.length - 1].side !== sb && Math.abs(arc.sweep) < TAU - 1e-9) {
    throw new Error("segmentation: inconsistent arc crossing");
  }
  return subs;
}

function linkLoops(chains: Chain[], chords: Map<number, Chord>): Loop[] {
  const byStart = new Map<number, Chain>(chains.map((c) => [c.startId, c]));
  const seen = new Set<Chain>();
  const out: Loop[] = [];
  for (const first of chains) {
    if (seen.has(first)) continue;
    const loop: Loop = [];
    let cur = first;
    do {
      seen.add(cur);
      loop.push(...cur.edges);
      const chord = chords.get(cur.endId);
      if (!chord) throw new Error("segmentation: cut line crossings are inconsistent (invalid or self-intersecting input?)");
      loop.push(chord.edge);
      const next = byStart.get(chord.end);
      if (!next || (seen.has(next) && next !== first)) {
        throw new Error("segmentation: cut line crossings are inconsistent (invalid or self-intersecting input?)");
      }
      cur = next;
    } while (cur !== first);
    out.push(loop);
  }
  return out;
}

/** Turn loops into regions: CCW loops are outers, CW loops are holes of the smallest containing outer. */
function assemble(loops: Loop[], ai: AxisIdx): Region[] {
  const outers = loops.filter((l) => loopArea(l) > 0).map((outer) => ({ outer, holes: [] as Loop[], ring: flattenLoop(outer, 1e-3), area: loopArea(outer) }));
  for (const hole of loops.filter((l) => loopArea(l) < 0)) {
    const p = hole[0].a;
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) if (ringsContain([o.ring], p) && (!best || o.area < best.area)) best = o;
    if (!best) throw new Error("segmentation: orphan hole after cut");
    best.holes.push(hole);
  }
  const oi = 1 - ai;
  const regions = outers.map((o) => ({ outer: o.outer, holes: o.holes }));
  regions.sort((p, q) => {
    const bp = loopBBox(p.outer);
    const bq = loopBBox(q.outer);
    return bp[oi] - bq[oi] || bp[ai] - bq[ai];
  });
  return regions;
}

interface RawSplit {
  low: Region[];
  high: Region[];
  seams: Seam[];
  holesCrossed: number[];
}

function splitAt(region: Region, ai: AxisIdx, c: number): RawSplit {
  const oi = (1 - ai) as AxisIdx;
  const lowWhole: Loop[] = [];
  const highWhole: Loop[] = [];
  const chainsLow: Chain[] = [];
  const chainsHigh: Chain[] = [];
  const crossings: { id: number; o: number; p: Pt }[] = [];
  const holesCrossed = new Set<number>();

  [region.outer, ...region.holes].forEach((loop, li) => {
    const subs = loop.flatMap((e) => subdivide(e, ai, c));
    const n = subs.length;
    const starts: number[] = [];
    for (let i = 0; i < n; i++) if (subs[i].side !== subs[(i + n - 1) % n].side) starts.push(i);
    if (!starts.length) {
      (subs[0].side < 0 ? lowWhole : highWhole).push(subs.map((s) => s.edge));
      return;
    }
    if (li > 0) holesCrossed.add(li - 1);
    const base = crossings.length;
    for (const si of starts) {
      const p = subs[si].edge.a;
      crossings.push({ id: crossings.length, o: p[oi], p });
    }
    for (let r = 0; r < starts.length; r++) {
      const from = starts[r];
      const to = starts[(r + 1) % starts.length];
      const edges: Edge[] = [];
      let k = from;
      do {
        edges.push(subs[k].edge);
        k = (k + 1) % n;
      } while (k !== to);
      const chain: Chain = { startId: base + r, endId: base + ((r + 1) % starts.length), edges };
      (subs[from].side < 0 ? chainsLow : chainsHigh).push(chain);
    }
  });

  if (crossings.length % 2) throw new Error("segmentation: odd number of crossings (invalid input geometry)");

  // Material lies between crossing 0–1, 2–3, … along the cut line (even-odd rule).
  const sorted = crossings.slice().sort((p, q) => p.o - q.o);
  const lowChords = new Map<number, Chord>();
  const highChords = new Map<number, Chord>();
  const seams: Seam[] = [];
  for (let k = 0; k < sorted.length; k += 2) {
    const lo = sorted[k];
    const hi = sorted[k + 1];
    seams.push({ a: lo.p, b: hi.p });
    // Interior on the left of travel: low piece runs +o for a vertical cut, −o for a horizontal one.
    const [s, e] = ai === 0 ? [lo, hi] : [hi, lo];
    lowChords.set(s.id, { end: e.id, edge: { a: s.p, b: e.p } });
    highChords.set(e.id, { end: s.id, edge: { a: e.p, b: s.p } });
  }

  return {
    low: assemble([...lowWhole, ...linkLoops(chainsLow, lowChords)], ai),
    high: assemble([...highWhole, ...linkLoops(chainsHigh, highChords)], ai),
    seams,
    holesCrossed: [...holesCrossed].sort((p, q) => p - q),
  };
}

/** Picks the cut coordinate: `pos`, or the first nearby non-degenerate one for ALL given regions. */
function chooseCut(regions: Region[], ai: AxisIdx, pos: number, eps: number): number {
  let c = pos;
  let tries = 0;
  while (regions.some((r) => isDegenerate(r, ai, c, eps))) {
    if (++tries > MAX_SHIFT_TRIES) throw new Error("segmentation: could not find a non-degenerate cut position");
    c = pos + tries * SHIFT_STEP;
  }
  return c;
}

function splitWithPos(reg: Region, ai: AxisIdx, c: number, requestedPos: number): SplitResult {
  const raw = splitAt(reg, ai, c);
  const sum = (rs: Region[]) => rs.reduce((s, r) => s + regionArea(r), 0);
  return {
    ...raw,
    requestedPos,
    usedPos: c,
    shifted: c !== requestedPos,
    seamLength: raw.seams.reduce((s, m) => s + Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]), 0),
    areaError: Math.abs(sum(raw.low) + sum(raw.high) - regionArea(reg)),
  };
}

/**
 * Cut `region` with the line `axis = pos` and return the exact pieces on both sides.
 * Exact for lines and arcs. See `SplitResult.shifted` for the degenerate-line policy.
 */
export function splitRegion(region: Region, axis: Axis, pos: number, opts: SplitOptions = {}): SplitResult {
  const ai = axisIndex(axis);
  const reg = normalizeRegion(region);
  return splitWithPos(reg, ai, chooseCut([reg], ai, pos, opts.eps ?? DEFAULT_EPS), pos);
}

/**
 * Cut several regions with the same parallel lines (all `axis`, ascending positions).
 * One position is chosen per cut for ALL regions, so pieces on both sides mate exactly.
 * Strip i holds the pieces between cut i-1 and cut i (strips[0] below the first cut).
 */
export function sliceRegions(regions: Region[], axis: Axis, positions: number[]): SliceResult {
  for (let i = 1; i < positions.length; i++) {
    if (!(positions[i] - positions[i - 1] >= MIN_CUT_SPACING)) {
      throw new Error(`sliceRegion: cut positions must be ascending and ≥ ${MIN_CUT_SPACING} apart`);
    }
  }
  const ai = axisIndex(axis);
  let remaining: Region[] = regions.map(normalizeRegion);
  const strips: Region[][] = [];
  const cuts: CutRecord[] = [];
  let areaError = 0;
  for (const pos of positions) {
    const below: Region[] = [];
    const above: Region[] = [];
    const c = chooseCut(remaining, ai, pos, DEFAULT_EPS);
    const record: CutRecord = { requestedPos: pos, usedPos: c, shifted: c !== pos, seams: [], seamLength: 0, holesCrossed: [] };
    for (const piece of remaining) {
      const r = splitWithPos(piece, ai, c, pos);
      below.push(...r.low);
      above.push(...r.high);
      record.seams.push(...r.seams);
      record.seamLength += r.seamLength;
      record.holesCrossed.push(...r.holesCrossed);
      areaError = Math.max(areaError, r.areaError);
    }
    strips.push(below);
    cuts.push(record);
    remaining = above;
  }
  strips.push(remaining);
  return { strips, cuts, areaError };
}

/** Cut one region into strips with parallel lines (see `sliceRegions`). */
export function sliceRegion(region: Region, axis: Axis, positions: number[]): SliceResult {
  return sliceRegions([region], axis, positions);
}

/** Like `splitRegion` but cuts at exactly `pos`; returns null when that line is degenerate for the region (no shift). */
export function splitRegionExact(region: Region, axis: Axis, pos: number, opts: SplitOptions = {}): SplitResult | null {
  const ai = axisIndex(axis);
  const reg = normalizeRegion(region);
  if (isDegenerate(reg, ai, pos, opts.eps ?? DEFAULT_EPS)) return null;
  return splitWithPos(reg, ai, pos, pos);
}

export interface Box {
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
}

/**
 * The part of `region` inside an axis-aligned box. Missing / infinite bounds are ignored.
 * Bounds are applied exactly; a bound that is degenerate for the region falls back to the
 * shifted cut and sets `shifted`.
 */
export function clipRegionToBox(region: Region, box: Box): { pieces: Region[]; shifted: boolean } {
  let pieces: Region[] = [normalizeRegion(region)];
  let shifted = false;
  const apply = (axis: Axis, pos: number | undefined, keep: "low" | "high") => {
    if (pos === undefined || !Number.isFinite(pos)) return;
    const next: Region[] = [];
    for (const p of pieces) {
      let r = splitRegionExact(p, axis, pos);
      if (!r) {
        r = splitRegion(p, axis, pos);
        shifted = shifted || r.shifted;
      }
      next.push(...(keep === "low" ? r.low : r.high));
    }
    pieces = next;
  };
  apply("x", box.x0, "high");
  apply("x", box.x1, "low");
  apply("y", box.y0, "high");
  apply("y", box.y1, "low");
  return { pieces, shifted };
}

/** A point strictly inside the region's material (middle of the widest scan interval), or null. */
export function regionInteriorPoint(region: Region): Pt | null {
  const rings = regionRings(region, 1e-3);
  const [, y0, , y1] = regionBBox(region);
  for (const f of [0.5, 0.37, 0.63, 0.25, 0.75, 0.13, 0.87]) {
    const y = y0 + (y1 - y0) * f;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((p, q) => p - q);
    let best: Pt | null = null;
    let bestW = 1e-6;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] > bestW) {
        bestW = xs[k + 1] - xs[k];
        best = [(xs[k] + xs[k + 1]) / 2, y];
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Intervals (along the other axis, merged) where the region's STRAIGHT boundary runs along the
 * line `axis = pos`. Used to find which pieces touch across a seam.
 */
export function edgesOnLine(region: Region, axis: Axis, pos: number, tol = 1e-9): [number, number][] {
  const ai = axisIndex(axis);
  const oi = 1 - ai;
  const iv: [number, number][] = [];
  for (const loop of [region.outer, ...region.holes]) {
    for (const e of loop) {
      if (e.arc) continue;
      if (Math.abs(e.a[ai] - pos) <= tol && Math.abs(e.b[ai] - pos) <= tol) {
        const lo = Math.min(e.a[oi], e.b[oi]);
        const hi = Math.max(e.a[oi], e.b[oi]);
        if (hi - lo > tol) iv.push([lo, hi]);
      }
    }
  }
  iv.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of iv) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1e-9) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}
