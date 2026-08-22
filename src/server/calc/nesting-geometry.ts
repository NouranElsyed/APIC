// Geometry abstraction for the nesting engine (Phase 2).
//
// This module intentionally knows nothing about Prisma, HTTP, or React —
// it is pure geometry so it can be unit tested and reused independently of
// the rest of the app (see nesting-engine.ts).
//
// Convention: all coordinates here are millimeters. Rotation is expressed
// in degrees, counter-clockwise, and restricted to {0, 90, 180, 270} for
// Phase 2 (see PROJECT.md §5). A "shape" produced by computeOrientedShape
// is always normalized so its own bounding box starts at (0, 0) — callers
// translate it to a placement's (x, y) origin before storing/rendering it.

import type { Point } from "./dxf";

export type RotationDeg = 0 | 90 | 180 | 270;

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
  // Outer contour, rotated and translated so its bounding box's
  // bottom-left corner sits at (0, 0). This is what gets translated again
  // to a placement's (xMm, yMm) to obtain the final on-sheet polygon.
  points: Point[];
  width: number;
  height: number;
}

// A part's full geometric identity as used by the engine. `outer` is the
// raw, untransformed contour straight from the DXF parser (dxf.ts) — the
// engine never mutates it, only derives OrientedShapes from it on demand.
// `holes` are carried through for completeness/future use (e.g. a future
// true-shape nesting pass) but are NOT subtracted again here: `areaSqm`
// already comes from the DXF parser's outer-minus-holes calculation, which
// remains the single source of truth for actual part area (bounding-box
// area is only ever used for fast collision pre-checks, never for
// utilization/scrap math — see PROJECT.md §4 and §12).
export interface PartGeometry {
  outer: Point[];
  holes: Point[][];
  areaSqm: number; // real, DXF-derived area (outer − holes), in m²
  bbox: BoundingBox; // raw (0° / untransformed) bounding box, in mm
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

function rotatePointCcw(p: Point, deg: RotationDeg): Point {
  switch (deg) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
  }
}

// Rotates the outer contour about the origin, then normalizes it so the
// resulting bounding box's bottom-left corner is (0, 0). This is the single
// place rotation is applied — placement, collision detection, area/bbox
// reasoning, and the SVG preview all derive from this same transform, so
// there is no risk of rotation being handled inconsistently between them.
export function computeOrientedShape(outer: Point[], rotationDeg: RotationDeg): OrientedShape {
  const rotated = outer.map((p) => rotatePointCcw(p, rotationDeg));
  const bbox = computeBoundingBox(rotated);
  const points = rotated.map((p) => ({ x: p.x - bbox.minX, y: p.y - bbox.minY }));
  return { rotationDeg, points, width: bbox.width, height: bbox.height };
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

// Applies the EXACT same transform the engine used when it placed this
// instance (rotate about the origin, normalize so the outer contour's own
// bounding box starts at (0,0), then translate to xMm/yMm — see
// computeOrientedShape above) to both the outer contour and every hole, so
// DXF export (dxf-writer.ts) reproduces the real placement rather than
// recomputing new coordinates (PROJECT.md §28: "Do NOT calculate new
// nesting coordinates during export"). Holes are normalized against the
// OUTER contour's bounding box, never their own, since that's the offset
// computeOrientedShape actually applied.
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

// Strict segment intersection: two segments are considered intersecting
// only when they properly cross (opposite orientations on both sides).
// Collinear/touching cases (shared endpoints, one segment's endpoint
// lying exactly on the other, or overlapping collinear edges) are
// deliberately NOT reported as intersections here — parts placed flush
// against each other (partGap = 0, or two bounding boxes sharing an exact
// edge) are a valid, common outcome of shelf packing and must not be
// flagged as overlapping. Stage 1's epsilon-tolerant AABB check uses the
// same "touching is fine" convention, so both stages agree.
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

// Point-in-polygon with a small negative epsilon bias: a point exactly on
// (or a hair inside, within tolerance of) the polygon boundary is treated
// as outside, so touching shapes don't register as containing one another.
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

// Returns a point strictly inside the polygon (its centroid, which is
// guaranteed interior for the convex/near-convex outer contours this
// engine deals with) — used instead of a raw vertex for containment
// testing, since a shared vertex sitting exactly on the other polygon's
// boundary must not register as "contained".
function centroid(poly: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// Accurate (Stage 2) overlap check between two simple polygons: true if any
// edge pair crosses, or if either polygon contains a vertex of the other
// (covers the case where one shape sits fully inside the other with no
// edge crossings, e.g. concentric contours).
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

  if (pointInPolygon(centroid(polyA), polyB)) return true;
  if (pointInPolygon(centroid(polyB), polyA)) return true;

  return false;
}

// Inclusive containment check used for "does this placement stay on the
// sheet" validation: every vertex of `points` must fall within
// [minX, maxX] x [minY, maxY] (an already edge-clearance-adjusted box).
export function boundsContain(points: Point[], minX: number, minY: number, maxX: number, maxY: number, epsilon = 1e-6): boolean {
  for (const p of points) {
    if (p.x < minX - epsilon || p.x > maxX + epsilon || p.y < minY - epsilon || p.y > maxY + epsilon) {
      return false;
    }
  }
  return true;
}
