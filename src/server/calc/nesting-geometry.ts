// Geometry abstraction for the nesting engine (Phase 2 / Phase 2B).
import type { Point } from "./dxf";

export type RotationDeg = number;

export const SUPPORTED_ROTATIONS: RotationDeg[] = [0, 90, 180, 270];

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface OrientedShape {
  rotationDeg: RotationDeg;
  points: Point[];
  width: number;
  height: number;
}

export interface PartGeometry {
  outer: Point[];
  holes: Point[][];
  areaSqm: number;
  bbox: BoundingBox;
}

export function computeBoundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function makePartGeometry(outer: Point[], holes: Point[][], areaSqm: number): PartGeometry {
  return { outer, holes, areaSqm, bbox: computeBoundingBox(outer) };
}

export function normalizeRotationDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

function rotatePointCcw(p: Point, deg: RotationDeg): Point {
  const norm = normalizeRotationDeg(deg);
  switch (norm) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
    default: {
      const rad = (norm * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
    }
  }
}

export function computeOrientedShape(outer: Point[], rotationDeg: RotationDeg): OrientedShape {
  const rotated = outer.map((p) => rotatePointCcw(p, rotationDeg));
  const bbox = computeBoundingBox(rotated);
  const points = rotated.map((p) => ({ x: p.x - bbox.minX, y: p.y - bbox.minY }));
  return { rotationDeg, points, width: bbox.width, height: bbox.height };
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function transformGeometryForPlacement(
  outer: Point[],
  holes: Point[][],
  rotationDeg: RotationDeg,
  xMm: number,
  yMm: number,
): { outer: Point[]; holes: Point[][] } {
  const rotatedOuter = outer.map((p) => rotatePointCcw(p, rotationDeg));
  const bbox = computeBoundingBox(rotatedOuter);
  const finalOuter = rotatedOuter.map((p) => ({ x: p.x - bbox.minX + xMm, y: p.y - bbox.minY + yMm }));
  const finalHoles = holes.map((hole) =>
    hole.map((p) => {
      const r = rotatePointCcw(p, rotationDeg);
      return { x: r.x - bbox.minX + xMm, y: r.y - bbox.minY + yMm };
    }),
  );
  return { outer: finalOuter, holes: finalHoles };
}

export function aabbOverlap(a: BoundingBox, b: BoundingBox, epsilon = 1e-6): boolean {
  return (
    a.minX < b.maxX - epsilon &&
    a.maxX > b.minX + epsilon &&
    a.minY < b.maxY - epsilon &&
    a.maxY > b.minY + epsilon
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) < 1e-6) return 0;
  return val > 0 ? 1 : 2;
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

export function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function centroid(poly: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// Tiny inward nudge used only to disambiguate exact-boundary sample points
// (see polygonsOverlap doc comment below). Far below any physically
// meaningful tolerance for mm-scale sheet-metal geometry (0.1 micron) and
// consistent with this file's other numerical epsilons (1e-6 in
// `orientation`/`aabbOverlap`/`boundsContain`); chosen a couple of orders
// larger than those purely to comfortably clear floating-point noise in the
// ray-casting `pointInPolygon` test at an exact boundary coordinate.
const OVERLAP_SAMPLE_NUDGE_MM = 1e-4;

/**
 * Nudges `p` a hair towards `poly`'s own centroid. For any point ON poly's
 * boundary (a vertex or edge midpoint), this reliably lands just inside
 * poly's interior — which is exactly what's needed to get a deterministic,
 * side-of-the-boundary answer out of `pointInPolygon`'s exact-boundary-value
 * ambiguity (see below) without changing what "inside" means anywhere else.
 */
function nudgeTowardCentroid(p: Point, poly: Point[]): Point {
  const c = centroid(poly);
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return p;
  return { x: p.x + (dx / len) * OVERLAP_SAMPLE_NUDGE_MM, y: p.y + (dy / len) * OVERLAP_SAMPLE_NUDGE_MM };
}

/**
 * Bug fix (Phase 5 hardening): the previous implementation only tested
 * proper edge CROSSINGS (segmentsIntersect requires every orientation to be
 * non-zero, i.e. it deliberately ignores collinear/touching cases — see
 * `orientation`) plus each polygon's single CENTROID against the other.
 * That combination has a real false-negative: two axis-aligned rectangles
 * that share the same y-range and only overlap by sliding along x (e.g.
 * [600,1500]x[0,700] vs [1100,2000]x[0,700]) have every vertex sitting
 * exactly ON the other rectangle's boundary (never strictly inside, because
 * the y-extents coincide exactly), no edge pair properly CROSSES (the
 * shared top/bottom edges are collinear, and the perpendicular edges only
 * meet those at T-junctions), and neither centroid lands inside the other
 * (a <50%-overlap slide keeps both centroids outside) — so the old test
 * returned `false` for a genuine ~40% positive-area overlap. This is
 * exactly the dense, edge-aligned overlap pattern the new Phase 5 block/grid
 * candidates are prone to producing, which is how it surfaced.
 *
 * Fix: in addition to the existing edge-crossing and centroid checks, also
 * test every VERTEX and every EDGE MIDPOINT of each polygon against the
 * other. A perpendicular edge's midpoint is immune to the "sits exactly on
 * the other polygon's boundary" degeneracy above (e.g. rect A's right-edge
 * midpoint (1500,350) is genuinely strictly inside rect B in the example
 * above, even though every VERTEX of A merely touches B's boundary), which
 * is what closes the gap. Each sample point is first nudged an infinitesimal
 * distance toward its OWN polygon's centroid before the point-in-polygon
 * test: without this, a sample that lies exactly on the OTHER polygon's
 * boundary too (the flush-edge / corner-touch / T-junction "just touching"
 * cases) hits `pointInPolygon`'s ray-casting boundary ambiguity and can
 * resolve to either side depending on which edge's half-open interval
 * happens to catch it — nudging the sample into its own polygon's interior
 * first resolves that ambiguity deterministically and correctly: it moves
 * AWAY from the other polygon when only touching (so touching still
 * reports no overlap), while a sample from a real interior-overlap region
 * simply stays inside the other polygon (so genuine overlap is unaffected).
 * This keeps the same bounded O(|A|*|B|) shape as before (a fixed, small
 * multiple of point-in-polygon tests — no new O(n!) or unbounded work) and
 * changes nothing about how zero-area touching is classified; see the
 * dedicated regression tests in nesting-geometry.test.ts.
 */
function polygonSamplePoints(poly: Point[]): Point[] {
  const points: Point[] = poly.map((p) => nudgeTowardCentroid(p, poly));
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    points.push(nudgeTowardCentroid(mid, poly));
  }
  return points;
}

export function polygonsOverlap(polyA: Point[], polyB: Point[]): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  // Vertices + edge midpoints of A (nudged into A's own interior) against
  // B, and of B against A — see the doc comment above for why this (not
  // just the raw centroid) is required to catch the axis-aligned "sliding
  // overlap" false negative while still correctly excluding touching-only
  // contact.
  for (const p of polygonSamplePoints(polyA)) {
    if (pointInPolygon(p, polyB)) return true;
  }
  for (const p of polygonSamplePoints(polyB)) {
    if (pointInPolygon(p, polyA)) return true;
  }
  if (pointInPolygon(centroid(polyA), polyB)) return true;
  if (pointInPolygon(centroid(polyB), polyA)) return true;
  return false;
}

function distPointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function distSegmentToSegment(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointToSegment(a1, b1, b2),
    distPointToSegment(a2, b1, b2),
    distPointToSegment(b1, a1, a2),
    distPointToSegment(b2, a1, a2),
  );
}

/**
 * Exact minimum distance between two simple polygons' boundaries (edge to
 * edge), or 0 if they overlap/touch. Unlike a bounding-box comparison,
 * this correctly handles non-rectangular outlines (triangles, cut
 * corners, L-shapes, etc.) — a shape's bbox can include a lot of empty
 * space that isn't actually part of the outline, which makes a
 * bbox-based gap check reject positions that are, geometrically, still
 * far enough away. Used to enforce partGapMm as a real clearance
 * requirement rather than a bounding-box approximation.
 */
export function polygonsMinDistance(polyA: Point[], polyB: Point[]): number {
  if (polyA.length < 2 || polyB.length < 2) return Infinity;
  if (polygonsOverlap(polyA, polyB)) return 0;
  let min = Infinity;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      const d = distSegmentToSegment(a1, a2, b1, b2);
      if (d < min) min = d;
    }
  }
  return min;
}

export function boundsContain(points: Point[], minX: number, minY: number, maxX: number, maxY: number, epsilon = 1e-6): boolean {
  for (const p of points) {
    if (p.x < minX - epsilon || p.x > maxX + epsilon || p.y < minY - epsilon || p.y > maxY + epsilon) {
      return false;
    }
  }
  return true;
}

export interface UsableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ObstacleBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Projects a raw, mouse-derived shape origin onto the nearest position that
 * keeps the shape's bounding box fully inside `bounds` (the usable/margin
 * area) and at least `gapMm` away from every obstacle box (already-committed
 * parts, expanded by the gap).
 *
 * This is a pure function of its inputs — it does not remember anything
 * about previous frames — so the result is deterministic for any given
 * (rawOriginX, rawOriginY, shapeWidth, shapeHeight, bounds, obstacles, gap).
 * The same rectangular, bounding-box based collision model used by the
 * shelf-packing engine (nesting-engine.ts) is reused here for consistency.
 *
 * Note: this is a bounding-box projection, used purely to drive the visual
 * ghost. It intentionally over-approximates non-rectangular outlines (a
 * concave/L-shaped part is treated as its rectangular bbox for the purpose
 * of "where can the ghost slide to"). Exact polygon-level validity (used to
 * gate the actual click-to-place) must still be checked separately with
 * `polygonsOverlap`/`boundsContain` against the real outline.
 */
export function findNearestValidOrigin(
  rawOriginX: number,
  rawOriginY: number,
  shapeWidth: number,
  shapeHeight: number,
  bounds: UsableBounds,
  obstacles: ObstacleBox[],
  gapMm: number,
): { x: number; y: number; fits: boolean } {
  const usableW = bounds.maxX - bounds.minX;
  const usableH = bounds.maxY - bounds.minY;

  // The shape doesn't fit inside the usable area at all — nothing we do
  // here can make it valid. Clamp to the top-left corner and report
  // fits: false so the caller can still show a (necessarily invalid) ghost.
  if (shapeWidth > usableW || shapeHeight > usableH) {
    return { x: bounds.minX, y: bounds.minY, fits: false };
  }

  // 1) Clamp to the usable/margin rectangle (handles source-edge + margin).
  let x = clampNum(rawOriginX, bounds.minX, bounds.maxX - shapeWidth);
  let y = clampNum(rawOriginY, bounds.minY, bounds.maxY - shapeHeight);

  // 2) Iteratively push out of any obstacle (expanded by the required
  // gap), resolving along the axis of minimum overlap each pass, then
  // re-clamping to the usable rectangle after every push. A handful of
  // passes is enough for the small, mostly-disjoint obstacle sets a
  // nesting sheet has.
  const MAX_PASSES = 12;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const box of obstacles) {
      const ex = { minX: box.minX - gapMm, minY: box.minY - gapMm, maxX: box.maxX + gapMm, maxY: box.maxY + gapMm };
      const candMaxX = x + shapeWidth;
      const candMaxY = y + shapeHeight;

      const overlapX = Math.min(candMaxX, ex.maxX) - Math.max(x, ex.minX);
      const overlapY = Math.min(candMaxY, ex.maxY) - Math.max(y, ex.minY);
      if (overlapX <= 0 || overlapY <= 0) continue; // no collision with this obstacle

      moved = true;
      const candCenterX = x + shapeWidth / 2;
      const candCenterY = y + shapeHeight / 2;
      const exCenterX = (ex.minX + ex.maxX) / 2;
      const exCenterY = (ex.minY + ex.maxY) / 2;

      // Push out along the axis with the smaller overlap — the shortest
      // way out of the collision.
      if (overlapX < overlapY) {
        x += candCenterX < exCenterX ? -overlapX : overlapX;
      } else {
        y += candCenterY < exCenterY ? -overlapY : overlapY;
      }
      // Re-clamp to the usable rectangle: pushing out of one obstacle
      // must never push the shape past the sheet/margin boundary.
      x = clampNum(x, bounds.minX, bounds.maxX - shapeWidth);
      y = clampNum(y, bounds.minY, bounds.maxY - shapeHeight);
    }
    if (!moved) break;
  }

  // Final check: did we actually land somewhere clear of every obstacle?
  // (Dense obstacle layouts can leave no valid spot near the cursor.)
  const finalMaxX = x + shapeWidth;
  const finalMaxY = y + shapeHeight;
  const stillColliding = obstacles.some((box) => {
    const ex = { minX: box.minX - gapMm, minY: box.minY - gapMm, maxX: box.maxX + gapMm, maxY: box.maxY + gapMm };
    return x < ex.maxX && finalMaxX > ex.minX && y < ex.maxY && finalMaxY > ex.minY;
  });

  return { x, y, fits: !stillColliding };
}

function clampNum(v: number, min: number, max: number): number {
  if (max < min) return min; // degenerate range — shouldn't happen once `fits` is checked upstream
  return Math.min(Math.max(v, min), max);
}

export function convexHull(points: Point[]): Point[] {
  const pts = [...points]
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
  if (pts.length <= 2) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function computeMinBoundingBoxAngles(outer: Point[]): number[] {
  const hull = convexHull(outer);
  if (hull.length < 2) return [0];
  const seen = new Set<string>();
  const angles: number[] = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
    let deg = normalizeRotationDeg(-(Math.atan2(dy, dx) * 180) / Math.PI);
    deg = deg % 90;
    const key = deg.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      angles.push(deg);
    }
  }
  return angles.length > 0 ? angles : [0];
}

export function generateRotationCandidates(outer: Point[], rotationStepDeg: number, maxCandidates: number): RotationDeg[] {
  const priority: number[] = [0, 90, 180, 270];
  const hullAngles = computeMinBoundingBoxAngles(outer);
  for (const base of hullAngles) {
    for (const add of [0, 90, 180, 270]) {
      priority.push(normalizeRotationDeg(base + add));
    }
  }
  const fallback: number[] = [];
  if (rotationStepDeg > 0 && rotationStepDeg < 360) {
    for (let d = 0; d < 360; d += rotationStepDeg) fallback.push(d);
  }
  const seen = new Set<string>();
  const result: RotationDeg[] = [];
  const addUnique = (deg: number) => {
    const norm = normalizeRotationDeg(deg);
    const key = norm.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    result.push(norm);
    return true;
  };
  for (const deg of priority) {
    if (result.length >= maxCandidates) break;
    addUnique(deg);
  }
  for (const deg of fallback) {
    if (result.length >= maxCandidates) break;
    addUnique(deg);
  }
  return result;
}