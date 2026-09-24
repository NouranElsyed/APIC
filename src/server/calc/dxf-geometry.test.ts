import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ARC_TOLERANCE_MM, parseDxf, type Point } from "./dxf";

// Phase 0 — DXF geometry correctness:
//   1. LWPOLYLINE/POLYLINE `bulge` and ARC entities are real arcs,
//   2. tessellated CONSERVATIVELY within a configurable tolerance,
//   3. contours are classified by containment (independent parts vs holes).

// ---- small DXF builders ----------------------------------------------------

const KAPPA = Math.tan(Math.PI / 8); // bulge of a 90° arc

function buildDxf(entities: string[], insUnits?: number): string {
  const header = insUnits === undefined ? "" : ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(insUnits), "0", "ENDSEC"].join("\n") + "\n";
  return header + ["0", "SECTION", "2", "ENTITIES"].join("\n") + "\n" + entities.join("") + ["0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
}

interface V {
  x: number;
  y: number;
  bulge?: number;
}

function lwpolyline(pts: V[], closed = true): string {
  const lines = ["0", "LWPOLYLINE", "8", "0", "90", String(pts.length), "70", closed ? "1" : "0"];
  for (const p of pts) {
    lines.push("10", String(p.x), "20", String(p.y));
    if (p.bulge !== undefined) lines.push("42", String(p.bulge));
  }
  return lines.join("\n") + "\n";
}

function polyline(pts: V[], closed = true): string {
  const lines = ["0", "POLYLINE", "8", "0", "66", "1", "70", closed ? "1" : "0"];
  for (const p of pts) {
    lines.push("0", "VERTEX", "8", "0", "10", String(p.x), "20", String(p.y));
    if (p.bulge !== undefined) lines.push("42", String(p.bulge));
  }
  lines.push("0", "SEQEND");
  return lines.join("\n") + "\n";
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return ["0", "LINE", "8", "0", "10", String(x1), "20", String(y1), "11", String(x2), "21", String(y2)].join("\n") + "\n";
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  return ["0", "ARC", "8", "0", "10", String(cx), "20", String(cy), "40", String(r), "50", String(startDeg), "51", String(endDeg)].join("\n") + "\n";
}

function circle(cx: number, cy: number, r: number): string {
  return ["0", "CIRCLE", "8", "0", "10", String(cx), "20", String(cy), "40", String(r)].join("\n") + "\n";
}

function square(x: number, y: number, size: number): string {
  return lwpolyline([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]);
}

// ---- small geometry helpers (independent of the code under test) -----------

function areaOf(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolygon(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

function strictlyInside(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Inside the polygon, or on its boundary (within eps). */
function coveredBy(p: Point, poly: Point[], eps = 1e-6): boolean {
  return strictlyInside(p, poly) || distToPolygon(p, poly) <= eps;
}

function arcSamples(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, n = 720): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function grid(minX: number, minY: number, maxX: number, maxY: number, step: number): Point[] {
  const out: Point[] = [];
  for (let x = minX; x <= maxX + 1e-9; x += step) for (let y = minY; y <= maxY + 1e-9; y += step) out.push({ x, y });
  return out;
}

function parseSingle(dxf: string, tol?: number) {
  const r = parseDxf(dxf, tol === undefined ? {} : { arcToleranceMm: tol });
  expect(r.errorMessage).toBeNull();
  expect(r.valid).toBe(true);
  expect(r.parts).toHaveLength(1);
  return r;
}

// ============================================================================
// 1. Real CAD file: part_1.dxf
// ============================================================================

// 500 × 1000 mm plate, mm units. One closed LWPOLYLINE (6 vertices, TWO of its
// segments carry bulge −tan(π/8): 90° convex fillets of radius 35 mm at the
// top-right and bottom-left corners) plus three CIRCLEs (Ø213.5 and 2 × Ø94.5).
// Before Phase 0 the bulges were ignored and the fillets became straight
// 35 × 35 chamfers — a contour up to 10.25 mm INSIDE the real cutting line.
const FIXTURE = readFileSync(new URL("./__fixtures__/part_1.dxf", import.meta.url), "utf-8");

const FILLET_R = 35;
// Fillet centres: the corner of the bounding box moved inwards by the radius.
const FILLETS = [
  { name: "top-right", cx: 2937.539522754598, cy: 1899.857235958611, fromDeg: 0, toDeg: 90 },
  { name: "bottom-left", cx: 2507.539522754598, cy: 969.8572359586107, fromDeg: 180, toDeg: 270 },
];
const HOLES = [
  { cx: 2705.039522754598, cy: 1417.357235958611, r: 106.7312974193282 },
  { cx: 2705.039522754598, cy: 1718.2331219429, r: 47.25875741515688 },
  { cx: 2705.039522754598, cy: 1116.481349974322, r: 47.25875741515688 },
];
// Exact (analytic) net area of the real part in mm²: rectangle − 2 corner
// cut-offs (r²(1 − π/4) each) − the three true circles.
const TRUE_AREA_MM2 = 500 * 1000 - 2 * FILLET_R * FILLET_R * (1 - Math.PI / 4) - Math.PI * HOLES.reduce((s, h) => s + h.r * h.r, 0);

describe("part_1.dxf — real CAD file with two bulged corners and three circular holes", () => {
  const result = parseDxf(FIXTURE);

  it("parses as ONE valid part in mm: 500 × 1000, one outer contour, three holes", () => {
    expect(result.valid).toBe(true);
    expect(result.unitsDetected).toBe("mm");
    expect(result.parts).toHaveLength(1);
    expect(result.outerContourCount).toBe(1);
    expect(result.holeCount).toBe(3);
    expect(result.bboxWidthMm).toBeCloseTo(500, 6);
    expect(result.bboxHeightMm).toBeCloseTo(1000, 6);
    expect(result.geometry).not.toBeNull();
  });

  it("represents both bulged corners as ARCS, not straight chamfers", () => {
    const outer = result.geometry!.outer;
    // 6 real vertices + 2 arcs; a straight chamfer would leave exactly 6.
    expect(outer.length).toBeGreaterThan(6);
    for (const f of FILLETS) {
      const vertsOnArc = outer.filter((p) => Math.abs(Math.hypot(p.x - f.cx, p.y - f.cy) - FILLET_R) <= DEFAULT_ARC_TOLERANCE_MM + 1e-9);
      // A 90° arc at 0.1 mm tolerance needs ~11 segments; a chamfer has 2 (its ends).
      expect(vertsOnArc.length, `${f.name} fillet vertex count`).toBeGreaterThanOrEqual(10);

      // The 45° point of the true arc is ~10.25 mm beyond the old chamfer line
      // (r·(1 − cos 45°)); the old parser's polygon did NOT contain it.
      const midRad = (((f.fromDeg + f.toDeg) / 2) * Math.PI) / 180;
      const mid = { x: f.cx + FILLET_R * Math.cos(midRad), y: f.cy + FILLET_R * Math.sin(midRad) };
      expect(coveredBy(mid, outer), `${f.name} arc midpoint covered`).toBe(true);
    }
  });

  it("conservatively covers the real arcs: never inside them, never more than the tolerance outside", () => {
    const outer = result.geometry!.outer;
    for (const f of FILLETS) {
      for (const p of arcSamples(f.cx, f.cy, FILLET_R, f.fromDeg, f.toDeg)) {
        // (a) superset: every point of the true boundary is inside (or on) the polygon…
        expect(coveredBy(p, outer), `${f.name} arc point (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`).toBe(true);
        // (b) …and the polygon boundary is never farther than the tolerance from it.
        expect(distToPolygon(p, outer)).toBeLessThanOrEqual(DEFAULT_ARC_TOLERANCE_MM + 1e-9);
      }
    }
  });

  it("keeps the three CIRCLEs as holes with the pre-existing 64-vertex inscribed tessellation", () => {
    const holes = result.geometry!.holes;
    expect(holes).toHaveLength(3);
    // Holes come back largest first (unchanged ordering rule).
    const bySize = [...HOLES].sort((a, b) => b.r - a.r);
    holes.forEach((hole, i) => {
      const expected = bySize[i];
      expect(hole).toHaveLength(64);
      // First vertex at angle 0, every vertex exactly ON the circle (inscribed),
      // exactly like the original CIRCLE code path.
      expect(hole[0].x).toBeCloseTo(expected.cx + expected.r, 9);
      expect(hole[0].y).toBeCloseTo(expected.cy, 9);
      for (const p of hole) expect(Math.hypot(p.x - expected.cx, p.y - expected.cy)).toBeCloseTo(expected.r, 9);
      // Each hole lies entirely inside the outer contour.
      for (const p of hole) expect(strictlyInside(p, result.geometry!.outer)).toBe(true);
    });
  });

  it("has the expected net area, within a documented tolerance", () => {
    // Expected: exact analytic area of the real part (0.4496537 m²).
    //
    // The polygon area is deliberately a hair ABOVE it — that is the
    // conservative direction (material region ⊇ real one):
    //   + ~80 mm² : the three CIRCLE holes are 64-gons inscribed in the true
    //               circles (pre-existing, unchanged behaviour), so the holes
    //               are slightly smaller than real;
    //   + ~3  mm² : circumscribed (tangent) arc polygons on the two fillets.
    //   → about +0.0185 % in total.
    // The old parser (fillets as straight chamfers) was 0.14 % BELOW the true
    // area (0.449035 m²), i.e. it under-estimated the part.
    const trueM2 = TRUE_AREA_MM2 / 1_000_000;
    expect(result.areaSqm!).toBeGreaterThanOrEqual(trueM2 - 1e-9); // never below the real area
    expect(result.areaSqm!).toBeLessThanOrEqual(trueM2 * 1.0005); // and within +0.05 %
  });

  it("honours a configurable tolerance: tighter → more vertices, always conservative and within tolerance", () => {
    const counts: number[] = [];
    for (const tol of [1, 0.1, 0.01]) {
      const r = parseDxf(FIXTURE, { arcToleranceMm: tol });
      const outer = r.geometry!.outer;
      counts.push(outer.length);
      for (const f of FILLETS) {
        for (const p of arcSamples(f.cx, f.cy, FILLET_R, f.fromDeg, f.toDeg, 360)) {
          expect(coveredBy(p, outer), `tol ${tol}`).toBe(true);
          expect(distToPolygon(p, outer)).toBeLessThanOrEqual(tol + 1e-9);
        }
      }
    }
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it("rejects a non-positive / non-finite tolerance instead of silently using a default", () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseDxf(FIXTURE, { arcToleranceMm: bad })).toThrow(RangeError);
    }
  });
});

// ============================================================================
// 2. Bulge / ARC: conservative in BOTH directions (outer ⊇ real, hole ⊆ real)
// ============================================================================

// Shared property check for a shape made of one outer loop with bulge arcs.
//   isInTrue     – analytic membership of the REAL region
//   trueAreaMm2  – its exact area
//   arcLengthMm  – total arc length (bounds how far the polygon may overshoot)
function expectOuterConservative(poly: Point[], bounds: [number, number, number, number], isInTrue: (p: Point) => boolean, trueAreaMm2: number, arcLengthMm: number, tol = DEFAULT_ARC_TOLERANCE_MM) {
  for (const p of grid(...bounds, 0.5)) {
    if (isInTrue(p)) expect(coveredBy(p, poly), `real point (${p.x}, ${p.y}) must be inside the polygon`).toBe(true);
  }
  const a = areaOf(poly);
  expect(a).toBeGreaterThanOrEqual(trueAreaMm2 - 1e-6);
  expect(a).toBeLessThanOrEqual(trueAreaMm2 + tol * arcLengthMm + 1e-6);
}

describe("LWPOLYLINE bulge — outer contours", () => {
  it("convex arcs (rounded rectangle, bulge on every corner incl. the closing segment): polygon ⊇ real shape", () => {
    // 100 × 60 plate, four r = 10 fillets. CCW traversal → positive bulge on convex corners.
    const dxf = buildDxf([
      lwpolyline([
        { x: 10, y: 0 },
        { x: 90, y: 0, bulge: KAPPA },
        { x: 100, y: 10 },
        { x: 100, y: 50, bulge: KAPPA },
        { x: 90, y: 60 },
        { x: 10, y: 60, bulge: KAPPA },
        { x: 0, y: 50 },
        { x: 0, y: 10, bulge: KAPPA }, // closing segment (last → first)
      ]),
    ]);
    const r = parseSingle(dxf);
    const inTrue = (p: Point) => {
      if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 60) return false;
      const cx = p.x < 10 ? 10 : p.x > 90 ? 90 : p.x;
      const cy = p.y < 10 ? 10 : p.y > 50 ? 50 : p.y;
      return Math.hypot(p.x - cx, p.y - cy) <= 10 + 1e-12;
    };
    const trueArea = 100 * 60 - 4 * 100 * (1 - Math.PI / 4);
    expectOuterConservative(r.geometry!.outer, [0, 0, 100, 60], inTrue, trueArea, 4 * (Math.PI / 2) * 10);
    expect(r.geometry!.outer.length).toBeGreaterThan(8);
  });

  it("clockwise-traversed convex arcs (negative bulge) are handled identically", () => {
    // Same plate, traversed clockwise → negative bulges.
    const dxf = buildDxf([
      lwpolyline([
        { x: 0, y: 10 },
        { x: 0, y: 50, bulge: -KAPPA },
        { x: 10, y: 60 },
        { x: 90, y: 60, bulge: -KAPPA },
        { x: 100, y: 50 },
        { x: 100, y: 10, bulge: -KAPPA },
        { x: 90, y: 0 },
        { x: 10, y: 0, bulge: -KAPPA },
      ]),
    ]);
    const r = parseSingle(dxf);
    const trueArea = 100 * 60 - 4 * 100 * (1 - Math.PI / 4);
    expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual(trueArea - 1e-6);
    expect(areaOf(r.geometry!.outer)).toBeLessThanOrEqual(trueArea + DEFAULT_ARC_TOLERANCE_MM * 62.9 + 1e-6);
    for (const p of arcSamples(90, 50, 10, 0, 90)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
  });

  it("concave arc (a semicircular notch bitten into the plate): polygon still ⊇ real shape", () => {
    // 100 × 50 plate with a radius-10 half-round notch cut into the top edge (bulge −1, CW, dips into the material).
    const dxf = buildDxf([
      lwpolyline([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 60, y: 50, bulge: -1 },
        { x: 40, y: 50 },
        { x: 0, y: 50 },
      ]),
    ]);
    const r = parseSingle(dxf);
    // The notch opening itself (y = 50, 40 < x < 60) is not material: it is the boundary of the removed half-disc.
    const inTrue = (p: Point) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 50 && !(p.y <= 50 && Math.hypot(p.x - 50, p.y - 50) < 10);
    expectOuterConservative(r.geometry!.outer, [0, 0, 100, 50], inTrue, 100 * 50 - (Math.PI * 100) / 2, Math.PI * 10);
  });

  it("major arc (|bulge| > 1, sweep > 180°): polygon ⊇ real shape", () => {
    // v0 (0,0) --bulge 2 (CCW, 4·atan 2 ≈ 253.7°)--> v1 (40,0), closed by the straight chord back.
    // Geometry: chord 40 → r = 40·(1+4)/(4·2) = 25, centre offset (20)(1−4)/(4) = −15 → centre (20, −15).
    // The region is the disc below the chord: {|p − (20,−15)| ≤ 25, y ≤ 0} (a major circular segment).
    const b = 2;
    const r = parseSingle(
      buildDxf([
        lwpolyline([
          { x: 0, y: 0, bulge: b },
          { x: 40, y: 0 },
        ]),
      ]),
    );
    const radius = 25;
    const sweep = 4 * Math.atan(b);
    const inTrue = (p: Point) => p.y <= 0 && Math.hypot(p.x - 20, p.y + 15) <= radius + 1e-12;
    const trueArea = (radius * radius * (sweep - Math.sin(sweep))) / 2;
    expectOuterConservative(r.geometry!.outer, [-10, -45, 50, 5], inTrue, trueArea, radius * sweep);
  });

  it("2-vertex closed polyline with two bulge-1 arcs is a full circle", () => {
    const dxf = buildDxf([
      lwpolyline([
        { x: -50, y: 0, bulge: 1 },
        { x: 50, y: 0, bulge: 1 },
      ]),
    ]);
    const r = parseSingle(dxf);
    for (const p of arcSamples(0, 0, 50, 0, 360, 360)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    const a = areaOf(r.geometry!.outer);
    expect(a).toBeGreaterThanOrEqual(Math.PI * 2500 - 1e-6);
    expect(a).toBeLessThanOrEqual(Math.PI * 2500 + DEFAULT_ARC_TOLERANCE_MM * 2 * Math.PI * 50);
  });

  it("POLYLINE + VERTEX bulge (group 42 on the vertex) is supported the same way", () => {
    const dxf = buildDxf([
      polyline([
        { x: 0, y: 0 },
        { x: 90, y: 0, bulge: KAPPA },
        { x: 100, y: 10 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]),
    ]);
    const r = parseSingle(dxf);
    for (const p of arcSamples(90, 10, 10, 270, 360)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    expect(r.geometry!.outer.length).toBeGreaterThan(5);
  });

  it("a zero / missing bulge leaves plain straight edges untouched", () => {
    const withZero = parseSingle(
      buildDxf([
        lwpolyline([
          { x: 0, y: 0, bulge: 0 },
          { x: 100, y: 0, bulge: 0 },
          { x: 100, y: 50, bulge: 0 },
          { x: 0, y: 50, bulge: 0 },
        ]),
      ]),
    );
    expect(withZero.geometry!.outer).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });
});

describe("LWPOLYLINE bulge — holes are conservative the other way (hole polygon ⊆ real hole)", () => {
  const frame = lwpolyline([
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ]);

  function expectHoleConservative(hole: Point[], bounds: [number, number, number, number], isInTrueHole: (p: Point) => boolean, trueHoleArea: number, arcLength: number) {
    // Everything inside the hole polygon must be inside the real hole (so the material polygon ⊇ real material).
    for (const p of grid(...bounds, 0.5)) {
      if (strictlyInside(p, hole)) expect(isInTrueHole(p), `(${p.x}, ${p.y}) is inside the hole polygon but outside the real hole`).toBe(true);
    }
    const a = areaOf(hole);
    expect(a).toBeLessThanOrEqual(trueHoleArea + 1e-6);
    expect(a).toBeGreaterThanOrEqual(trueHoleArea - DEFAULT_ARC_TOLERANCE_MM * arcLength - 1e-6);
  }

  it("convex hole (a slot with half-round ends)", () => {
    const dxf = buildDxf([
      frame,
      lwpolyline([
        { x: 60, y: 80 },
        { x: 140, y: 80, bulge: 1 },
        { x: 140, y: 120 },
        { x: 60, y: 120, bulge: 1 },
      ]),
    ]);
    const r = parseSingle(dxf);
    expect(r.geometry!.holes).toHaveLength(1);
    const inHole = (p: Point) => (p.x >= 60 && p.x <= 140 && p.y >= 80 && p.y <= 120) || Math.hypot(p.x - 140, p.y - 100) <= 20 + 1e-12 || Math.hypot(p.x - 60, p.y - 100) <= 20 + 1e-12;
    expectHoleConservative(r.geometry!.holes[0], [30, 70, 170, 130], inHole, 80 * 40 + Math.PI * 400, 2 * Math.PI * 20);
    // Net area is therefore never below the real net area.
    expect(r.areaSqm! * 1e6).toBeGreaterThanOrEqual(200 * 200 - (80 * 40 + Math.PI * 400) - 1e-6);
  });

  it("concave hole (material intrudes into the hole as a half-round)", () => {
    // Hole 80 × 40 with a radius-10 half-round bite taken out of its top edge (bulge −1).
    const dxf = buildDxf([
      frame,
      lwpolyline([
        { x: 60, y: 80 },
        { x: 140, y: 80 },
        { x: 140, y: 120 },
        { x: 110, y: 120, bulge: -1 },
        { x: 90, y: 120 },
        { x: 60, y: 120 },
      ]),
    ]);
    const r = parseSingle(dxf);
    expect(r.geometry!.holes).toHaveLength(1);
    const inHole = (p: Point) => p.x >= 60 && p.x <= 140 && p.y >= 80 && p.y <= 120 && !(p.y <= 120 && Math.hypot(p.x - 100, p.y - 120) < 10);
    expectHoleConservative(r.geometry!.holes[0], [50, 70, 150, 130], inHole, 80 * 40 - (Math.PI * 100) / 2, Math.PI * 10);
  });
});

describe("ARC entities chained with LINEs", () => {
  // 100 × 100 plate, four r = 10 fillets, drawn as 4 LINEs + 4 ARCs
  // (ARC entities are always counter-clockwise start → end angle).
  const roundedRectSegments = () => [
    line(10, 0, 90, 0),
    arc(90, 10, 10, 270, 360),
    line(100, 10, 100, 90),
    arc(90, 90, 10, 0, 90),
    line(90, 100, 10, 100),
    arc(10, 90, 10, 90, 180),
    line(0, 90, 0, 10),
    arc(10, 10, 10, 180, 270),
  ];
  const trueArea = 100 * 100 - 4 * 100 * (1 - Math.PI / 4);
  const corners = [
    [90, 10, 270, 360],
    [90, 90, 0, 90],
    [10, 90, 90, 180],
    [10, 10, 180, 270],
  ] as const;

  it("closes a LINE + ARC outline into one part whose polygon ⊇ the real fillets", () => {
    const r = parseSingle(buildDxf(roundedRectSegments()));
    expect(r.holeCount).toBe(0);
    for (const [cx, cy, a0, a1] of corners) for (const p of arcSamples(cx, cy, 10, a0, a1, 180)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    const a = areaOf(r.geometry!.outer);
    expect(a).toBeGreaterThanOrEqual(trueArea - 1e-6);
    expect(a).toBeLessThanOrEqual(trueArea + DEFAULT_ARC_TOLERANCE_MM * 4 * (Math.PI / 2) * 10);
    expect(r.geometry!.outer.length).toBeGreaterThan(8);
  });

  it("is independent of entity order and LINE direction", () => {
    const shuffled = [7, 2, 5, 0, 3, 6, 1, 4].map((i) => roundedRectSegments()[i]);
    const reversedLines = [line(90, 0, 10, 0), line(100, 90, 100, 10), line(10, 100, 90, 100), line(0, 10, 0, 90)];
    const arcs = [arc(90, 10, 10, 270, 360), arc(90, 90, 10, 0, 90), arc(10, 90, 10, 90, 180), arc(10, 10, 10, 180, 270)];
    const a = parseSingle(buildDxf(shuffled));
    const b = parseSingle(buildDxf([...arcs, ...reversedLines]));
    for (const r of [a, b]) {
      expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual(trueArea - 1e-6);
      expect(areaOf(r.geometry!.outer)).toBeLessThanOrEqual(trueArea + DEFAULT_ARC_TOLERANCE_MM * 63);
      for (const [cx, cy, a0, a1] of corners) for (const p of arcSamples(cx, cy, 10, a0, a1, 90)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    }
  });

  it("a full circle from two half-circle ARCs (two nodes, two arcs) is one closed loop", () => {
    const r = parseSingle(buildDxf([arc(0, 0, 50, 0, 180), arc(0, 0, 50, 180, 360)]));
    for (const p of arcSamples(0, 0, 50, 0, 360, 360)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual(Math.PI * 2500 - 1e-6);
  });

  it("a single 0°→360° ARC is a full circle", () => {
    const r = parseSingle(buildDxf([arc(10, 20, 30, 0, 360)]));
    for (const p of arcSamples(10, 20, 30, 0, 360, 360)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual(Math.PI * 900 - 1e-6);
  });

  it("a half-disc (ARC + the LINE across its diameter) is a valid 2-node loop", () => {
    const r = parseSingle(buildDxf([arc(0, 0, 50, 0, 180), line(-50, 0, 50, 0)]));
    for (const p of arcSamples(0, 0, 50, 0, 180, 180)) expect(coveredBy(p, r.geometry!.outer)).toBe(true);
    expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual((Math.PI * 2500) / 2 - 1e-6);
  });

  it("an ARC whose end angle is below its start angle wraps through 0° (350° → 10° is a 20° arc)", () => {
    const r = parseSingle(buildDxf([arc(0, 0, 50, 350, 10), line(50 * Math.cos((10 * Math.PI) / 180), 50 * Math.sin((10 * Math.PI) / 180), 50 * Math.cos((350 * Math.PI) / 180), 50 * Math.sin((350 * Math.PI) / 180))]));
    // A circular segment of 20° at r = 50: (r²/2)(θ − sin θ).
    const theta = (20 * Math.PI) / 180;
    const seg = (2500 / 2) * (theta - Math.sin(theta));
    expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual(seg - 1e-6);
    expect(areaOf(r.geometry!.outer)).toBeLessThanOrEqual(seg + DEFAULT_ARC_TOLERANCE_MM * 50 * theta + 1e-6);
  });

  it("an open ARC on its own is reported as an open contour", () => {
    const r = parseDxf(buildDxf([arc(0, 0, 50, 0, 90)]));
    expect(r.valid).toBe(false);
    expect(r.errorMessage).toMatch(/open contour/i);
  });

  it("an unrelated open ARC next to a closed part does not invalidate it", () => {
    const r = parseSingle(buildDxf([square(0, 0, 100), arc(500, 500, 20, 0, 90)]));
    expect(r.geometry!.outer).toHaveLength(4);
  });

  it("scales ARC centre and radius by $INSUNITS (1 in → 25.4 mm)", () => {
    const r = parseSingle(buildDxf([arc(0, 0, 1, 0, 180), arc(0, 0, 1, 180, 360)], 1));
    expect(r.unitsDetected).toBe("in");
    expect(areaOf(r.geometry!.outer)).toBeGreaterThanOrEqual(Math.PI * 25.4 * 25.4 - 1e-6);
    expect(areaOf(r.geometry!.outer)).toBeLessThanOrEqual(Math.PI * 25.4 * 25.4 + DEFAULT_ARC_TOLERANCE_MM * 2 * Math.PI * 25.4);
  });
});

describe("arc tessellation stays within the tolerance for very small and very large radii", () => {
  it.each([0.5, 5, 35, 500, 50_000])("radius %s mm", (r) => {
    const res = parseSingle(buildDxf([arc(0, 0, r, 0, 360)]));
    const outer = res.geometry!.outer;
    for (const p of arcSamples(0, 0, r, 0, 360, 360)) {
      expect(coveredBy(p, outer)).toBe(true);
      expect(distToPolygon(p, outer)).toBeLessThanOrEqual(DEFAULT_ARC_TOLERANCE_MM + 1e-9);
    }
  });
});

describe("CIRCLE behaviour is unchanged", () => {
  it("a lone CIRCLE is still a 64-vertex polygon inscribed in the circle, starting at angle 0", () => {
    const r = parseSingle(buildDxf([circle(100, 200, 25)]));
    const outer = r.geometry!.outer;
    expect(outer).toHaveLength(64);
    expect(outer[0].x).toBeCloseTo(125, 9);
    expect(outer[0].y).toBeCloseTo(200, 9);
    for (const p of outer) expect(Math.hypot(p.x - 100, p.y - 200)).toBeCloseTo(25, 9);
  });

  it("a circle inside a rectangle is still a hole", () => {
    const r = parseSingle(buildDxf([square(0, 0, 100), circle(50, 50, 10)]));
    expect(r.holeCount).toBe(1);
    expect(r.geometry!.holes[0]).toHaveLength(64);
  });
});

// ============================================================================
// 3. Contour hierarchy
// ============================================================================

describe("contour hierarchy — independent parts are NOT holes", () => {
  it("two separate closed contours are two independent parts (not outer + hole)", () => {
    const r = parseDxf(buildDxf([square(0, 0, 100), square(1000, 0, 30)]));
    expect(r.parts).toHaveLength(2);
    expect(r.outerContourCount).toBe(2);
    expect(r.holeCount).toBe(0);
    expect(r.parts.every((p) => p.holes.length === 0)).toBe(true);
    // Largest first, each with its own true area (the small one is NOT subtracted from the big one).
    expect(r.parts[0].areaSqm * 1e6).toBeCloseTo(10_000, 6);
    expect(r.parts[1].areaSqm * 1e6).toBeCloseTo(900, 6);
  });

  it("a multi-part file is rejected with an actionable message instead of silently picking one part", () => {
    const r = parseDxf(buildDxf([square(0, 0, 100), square(1000, 0, 30)]));
    expect(r.valid).toBe(false);
    expect(r.errorMessage).toMatch(/2 independent parts/);
    expect(r.errorMessage).toMatch(/single-part DXF/);
    expect(r.geometry).toBeNull();
    expect(r.areaSqm).toBeNull();
    // …but the breakdown is still available to callers that can handle it.
    expect(r.parts).toHaveLength(2);
  });

  it("each independent part keeps ITS OWN holes", () => {
    const r = parseDxf(
      buildDxf([
        square(0, 0, 100),
        square(20, 20, 20), // hole of the big part
        square(1000, 0, 50),
        circle(1025, 25, 10), // hole of the small part
      ]),
    );
    expect(r.parts).toHaveLength(2);
    expect(r.holeCount).toBe(2);
    const [big, small] = r.parts;
    expect(big.holes).toHaveLength(1);
    expect(small.holes).toHaveLength(1);
    expect(big.areaSqm * 1e6).toBeCloseTo(10_000 - 400, 6);
    // The circle is a 64-gon inscribed in r = 10 → area = 32·r²·sin(2π/64).
    expect(small.areaSqm * 1e6).toBeCloseTo(2500 - 32 * 100 * Math.sin((2 * Math.PI) / 64), 6);
    // The hole belongs to the part that contains it.
    for (const p of small.holes[0]) expect(p.x).toBeGreaterThan(1000);
    for (const p of big.holes[0]) expect(p.x).toBeLessThan(100);
  });

  it("a small contour inside the big part's BOUNDING BOX but outside its outline is a separate part", () => {
    // L-shaped plate; the little square sits in the notch: within the L's bbox, not within the L.
    const r = parseDxf(
      buildDxf([
        lwpolyline([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 40 },
          { x: 40, y: 40 },
          { x: 40, y: 100 },
          { x: 0, y: 100 },
        ]),
        square(60, 60, 20),
      ]),
    );
    expect(r.parts).toHaveLength(2);
    expect(r.holeCount).toBe(0);
  });

  it("an island inside a hole is an independent part again (even-odd nesting)", () => {
    // 100 plate, 60 hole in it, 20 island inside the hole.
    const r = parseDxf(buildDxf([square(0, 0, 100), square(20, 20, 60), square(40, 40, 20)]));
    expect(r.parts).toHaveLength(2);
    const [frame, island] = r.parts;
    expect(frame.holes).toHaveLength(1);
    expect(frame.areaSqm * 1e6).toBeCloseTo(10_000 - 3600, 6);
    expect(island.holes).toHaveLength(0);
    expect(island.areaSqm * 1e6).toBeCloseTo(400, 6);
  });

  it("a circle far away from a rectangle is a separate part, not a hole", () => {
    const r = parseDxf(buildDxf([square(0, 0, 100), circle(500, 500, 10)]));
    expect(r.parts).toHaveLength(2);
    expect(r.holeCount).toBe(0);
  });

  it("LINE + ARC outlines participate in the hierarchy (two independent rounded parts)", () => {
    const rounded = (ox: number) => [
      line(ox + 10, 0, ox + 90, 0),
      arc(ox + 90, 10, 10, 270, 360),
      line(ox + 100, 10, ox + 100, 90),
      arc(ox + 90, 90, 10, 0, 90),
      line(ox + 90, 100, ox + 10, 100),
      arc(ox + 10, 90, 10, 90, 180),
      line(ox, 90, ox, 10),
      arc(ox + 10, 10, 10, 180, 270),
    ];
    const r = parseDxf(buildDxf([...rounded(0), ...rounded(1000)]));
    expect(r.parts).toHaveLength(2);
    expect(r.holeCount).toBe(0);
  });

  it("the same contour drawn twice is one part — not a second part or a zero-area hole", () => {
    const r = parseSingle(buildDxf([square(0, 0, 100), square(0, 0, 100)]));
    expect(r.holeCount).toBe(0);
    expect(r.areaSqm! * 1e6).toBeCloseTo(10_000, 6);
  });

  it("degenerate zero-area contours are ignored", () => {
    const flat = lwpolyline([
      { x: 500, y: 0 },
      { x: 510, y: 0 },
      { x: 520, y: 0 },
    ]);
    const r = parseSingle(buildDxf([square(0, 0, 100), flat]));
    expect(r.geometry!.outer).toHaveLength(4);
  });

  it("a single-part file is unchanged: outer + holes, `parts[0]` equals `geometry`", () => {
    const r = parseSingle(buildDxf([square(0, 0, 100), circle(30, 50, 5), circle(70, 50, 5)]));
    expect(r.outerContourCount).toBe(1);
    expect(r.holeCount).toBe(2);
    expect(r.parts[0].outer).toEqual(r.geometry!.outer);
    expect(r.parts[0].holes).toEqual(r.geometry!.holes);
    expect(r.parts[0].areaSqm).toBe(r.areaSqm);
  });
});
