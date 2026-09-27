import { describe, expect, it } from "vitest";
import { generateRotationCandidates, detectRotationalSymmetryOrder, normalizeRotationDeg } from "./nesting-geometry";
import type { Point } from "./dxf";

// ----------------------------------------------------------------------------
// Focused tests for generateRotationCandidates() / symmetry-aware rotation
// pruning ONLY. These do not touch scoring, placement search, collision
// detection, ALNS, or multi-start — they exercise the pure geometry helper
// in isolation, the same way nesting-engine.test.ts exercises the packing
// helpers in isolation.
// ----------------------------------------------------------------------------

const DEFAULT_STEP = 5;
const DEFAULT_MAX = 64;

function rect(widthMm: number, heightMm: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ];
}

/** Regular n-gon centered at the origin — stands in for a tessellated circle. */
function regularPolygon(sides: number, radius = 50): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return pts;
}

/** L-bracket: no rotational symmetry of any order. */
function lBracket(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ];
}

/** Isosceles trapezoid: reflective symmetry only, no rotational symmetry. */
function trapezoid(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 75, y: 50 },
    { x: 25, y: 50 },
  ];
}

/** Fully irregular polygon: no symmetry of any kind. */
function irregularPolygon(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 83, y: 0 },
    { x: 120, y: 37 },
    { x: 95, y: 88 },
    { x: 40, y: 130 },
    { x: -10, y: 60 },
  ];
}

function uniqueMod(degs: number[], periodDeg: number): Set<string> {
  const set = new Set<string>();
  for (const d of degs) {
    let mod = normalizeRotationDeg(d) % periodDeg;
    if (mod > periodDeg - 1e-6) mod -= periodDeg;
    if (Math.abs(mod) < 1e-6) mod = 0;
    set.add(mod.toFixed(2));
  }
  return set;
}

describe("generateRotationCandidates — symmetry-aware pruning", () => {
  it("circle (regular polygon): redundant rotations collapse aggressively", () => {
    const outer = regularPolygon(36); // order-36 rotational symmetry
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBe(36);

    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    // Every candidate must be geometrically distinct modulo 360/36 = 10deg.
    const distinctKeys = uniqueMod(candidates, 360 / order);
    expect(distinctKeys.size).toBe(candidates.length);
    // A near-circular shape should collapse to very few meaningful angles,
    // not the full fallback grid (360/5 = 72 steps).
    expect(candidates.length).toBeLessThan(5);
  });

  it("square: 0/90/180/270 are geometrically equivalent and collapse to one orientation", () => {
    const outer = rect(50, 50);
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBe(4); // period = 90deg — rotating a true square by 90deg reproduces the identical polygon

    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    const normalized = candidates.map(normalizeRotationDeg);

    // The four canonical fixed rotations (0/90/180/270) are all congruent
    // mod the square's own 90deg symmetry period, so exactly ONE
    // representative of that bucket may survive — not all four.
    const zeroBucket = normalized.filter((d) => Math.abs((d % 90 + 90) % 90) < 1e-6);
    expect(zeroBucket.length).toBe(1);
    expect(zeroBucket[0]).toBeCloseTo(0, 5);

    // Finer fallback-grid angles (5deg, 10deg, ...) are genuinely DIFFERENT
    // footprints for a square (a 5deg-rotated square is not the same
    // polygon as an axis-aligned one) — symmetry pruning must NOT delete
    // those. Only exact 90deg-period duplicates are removed, so the result
    // should equal the full 90deg-period fallback grid, not just 1 angle.
    expect(candidates.length).toBe(90 / DEFAULT_STEP);
  });

  it("rectangle: 0/180 equivalent, 90/270 equivalent, but 0 and 90 are NOT equivalent", () => {
    const outer = rect(100, 40);
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBe(2); // period = 180deg — a rectangle maps onto itself only every half-turn

    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    const normalized = candidates.map(normalizeRotationDeg);

    const bucketOf = (d: number) => {
      let m = d % 180;
      if (m < 0) m += 180;
      return Math.round(m);
    };
    const buckets = normalized.map(bucketOf);

    // 0 and 180 must land in the SAME bucket (equivalent) — so 180 must
    // never appear as its own separate candidate once 0 exists.
    expect(normalized.some((d) => Math.abs(d - 180) < 1e-6)).toBe(false);
    expect(buckets.some((b) => b === 0)).toBe(true);

    // 90 and 270 must land in the SAME bucket (equivalent) — 270 must not
    // survive as its own candidate once 90 exists.
    expect(normalized.some((d) => Math.abs(d - 270) < 1e-6)).toBe(false);
    expect(buckets.some((b) => b === 90)).toBe(true);

    // But 0 and 90 must NOT be equivalent — both buckets must be present
    // and distinct, i.e. the meaningful orientation difference between an
    // upright and a sideways rectangle must be preserved.
    expect(new Set(buckets).has(0) && new Set(buckets).has(90)).toBe(true);

    // Every surviving candidate must be a distinct bucket (no leftover
    // duplicates) — confirms pruning removed exactly the equivalent ones.
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  it("L-bracket: does NOT collapse 0/90/180/270 (no rotational symmetry exists)", () => {
    const outer = lBracket();
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBe(1);

    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    const normalized = new Set(candidates.map((d) => Math.round(normalizeRotationDeg(d))));
    // All four axis-aligned fixed rotations must survive as distinct
    // candidates since the shape has no symmetry to justify collapsing them.
    for (const deg of [0, 90, 180, 270]) {
      expect(normalized.has(deg)).toBe(true);
    }
    // The fallback grid must still contribute more than just the 4 fixed
    // rotations — symmetry pruning must not have suppressed it.
    expect(candidates.length).toBeGreaterThan(4);
  });

  it("trapezoid: preserves all geometrically meaningful orientations (no rotational symmetry)", () => {
    const outer = trapezoid();
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBe(1);

    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    // With no symmetry, every priority + fallback angle is geometrically
    // distinct, so pruning must only ever remove EXACT numeric duplicates,
    // never a meaningful angle. The full fallback grid (360/5 = 72 steps)
    // plus priority angles, de-duplicated only for literal repeats, should
    // be preserved.
    const expectedFallbackCount = Math.ceil(360 / DEFAULT_STEP);
    expect(candidates.length).toBeGreaterThanOrEqual(Math.min(expectedFallbackCount, DEFAULT_MAX) - 4);
  });

  it("irregular polygon: preserves all meaningful rotation candidates (no symmetry)", () => {
    const outer = irregularPolygon();
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBe(1);

    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    const expectedFallbackCount = Math.ceil(360 / DEFAULT_STEP);
    expect(candidates.length).toBeGreaterThanOrEqual(Math.min(expectedFallbackCount, DEFAULT_MAX) - 4);
  });

  it("detecting symmetry does NOT by itself collapse to a single rotation (rectangle stays at 2, not 1)", () => {
    // Regression guard for the specific bug described: a shape with SOME
    // detected symmetry (order 2) must not have its entire fallback grid
    // suppressed down to one candidate — only angles proven equivalent
    // under its own period are removed.
    const outer = rect(120, 45);
    const order = detectRotationalSymmetryOrder(outer);
    expect(order).toBeGreaterThan(1); // symmetry WAS detected
    const candidates = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    expect(candidates.length).toBeGreaterThan(1); // but not collapsed to 1
  });

  it("fallback grid is not removed merely because a shape has some symmetry (asymmetric part parity check)", () => {
    const asymmetric = lBracket();
    const symmetricRect = rect(100, 40);
    const asymCandidates = generateRotationCandidates(asymmetric, DEFAULT_STEP, DEFAULT_MAX);
    const rectCandidates = generateRotationCandidates(symmetricRect, DEFAULT_STEP, DEFAULT_MAX);
    // The symmetric rectangle should legitimately produce FEWER unique
    // candidates than the fully asymmetric L-bracket (real duplicates
    // removed) — but it must still be more than the trivial single-angle
    // case, proving the fallback grid was consulted rather than skipped.
    expect(rectCandidates.length).toBeGreaterThan(1);
    expect(rectCandidates.length).toBeLessThan(asymCandidates.length);
  });

  it("deterministic ordering: repeated calls with identical input produce identical output", () => {
    const outer = irregularPolygon();
    const a = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    const b = generateRotationCandidates(outer, DEFAULT_STEP, DEFAULT_MAX);
    expect(a).toEqual(b);
  });

  it("maxCandidates cap is still respected after symmetry pruning", () => {
    const outer = lBracket();
    const capped = generateRotationCandidates(outer, DEFAULT_STEP, 6);
    expect(capped.length).toBeLessThanOrEqual(6);
  });
});