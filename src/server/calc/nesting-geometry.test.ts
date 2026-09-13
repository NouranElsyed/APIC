import { describe, expect, it } from "vitest";
import { computeOrientedShape, findNearestValidOrigin, polygonsOverlap, translatePoints } from "./nesting-geometry";
import type { Point } from "./dxf";

function rect(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

describe("polygonsOverlap", () => {
  it("does not flag two squares placed flush edge-to-edge as overlapping", () => {
    // Regression test: shelf packing places parts touching at x=100 with
    // partGap=0; this must be treated as valid, non-overlapping placement.
    const a = translatePoints(rect(100, 100), 0, 0);
    const b = translatePoints(rect(100, 100), 100, 0);
    expect(polygonsOverlap(a, b)).toBe(false);
  });

  it("flags two squares that genuinely overlap", () => {
    const a = translatePoints(rect(100, 100), 0, 0);
    const b = translatePoints(rect(100, 100), 50, 50);
    expect(polygonsOverlap(a, b)).toBe(true);
  });

  it("flags one square fully contained inside another (no edge crossings)", () => {
    const outer = translatePoints(rect(200, 200), 0, 0);
    const inner = translatePoints(rect(20, 20), 90, 90);
    expect(polygonsOverlap(outer, inner)).toBe(true);
  });

  it("does not flag two squares that merely share a single corner point", () => {
    const a = translatePoints(rect(100, 100), 0, 0);
    const b = translatePoints(rect(100, 100), 100, 100);
    expect(polygonsOverlap(a, b)).toBe(false);
  });
});

describe("computeOrientedShape", () => {
  it("swaps width/height for 90 and 270 degree rotations", () => {
    const outer = rect(300, 150);
    expect(computeOrientedShape(outer, 0)).toMatchObject({ width: 300, height: 150 });
    expect(computeOrientedShape(outer, 90)).toMatchObject({ width: 150, height: 300 });
    expect(computeOrientedShape(outer, 180)).toMatchObject({ width: 300, height: 150 });
    expect(computeOrientedShape(outer, 270)).toMatchObject({ width: 150, height: 300 });
  });

  it("always normalizes the shape so its bounding box starts at (0, 0)", () => {
    const outer: Point[] = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ];
    for (const rotation of [0, 90, 180, 270] as const) {
      const shape = computeOrientedShape(outer, rotation);
      const minX = Math.min(...shape.points.map((p) => p.x));
      const minY = Math.min(...shape.points.map((p) => p.y));
      expect(minX).toBeCloseTo(0, 6);
      expect(minY).toBeCloseTo(0, 6);
    }
  });
});

describe("findNearestValidOrigin — Phase 2C constrained ghost movement", () => {
  // A 2000x6000 usable sheet area (length=X horizontal, width=Y vertical),
  // matching the axis convention used across nesting-engine.ts / DXF writer.
  const bounds = { minX: 0, minY: 0, maxX: 6000, maxY: 2000 };

  it("TEST 1 — clamps to the usable boundary when the cursor goes past the right edge", () => {
    const part = findNearestValidOrigin(5990, 100, 500, 300, bounds, [], 0);
    expect(part.fits).toBe(true);
    expect(part.x).toBeCloseTo(6000 - 500, 6); // never exceeds maxX
    expect(part.x + 500).toBeLessThanOrEqual(6000 + 1e-6);
  });

  it("TEST 1b — clamps against every edge independently (left/top/bottom too)", () => {
    expect(findNearestValidOrigin(-500, 100, 300, 200, bounds, [], 0).x).toBeCloseTo(0, 6);
    expect(findNearestValidOrigin(100, -500, 300, 200, bounds, [], 0).y).toBeCloseTo(0, 6);
    expect(findNearestValidOrigin(100, 5000, 300, 200, bounds, [], 0).y).toBeCloseTo(2000 - 200, 6);
  });

  it("TEST 2 — rotated geometry (90°) still stays fully inside after clamping", () => {
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 200 },
      { x: 0, y: 200 },
    ];
    const shape = computeOrientedShape(outer, 90); // bbox becomes 200 x 800
    const result = findNearestValidOrigin(5990, 1990, shape.width, shape.height, bounds, [], 0);
    const polygon = translatePoints(shape.points, result.x, result.y);
    for (const p of polygon) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
      expect(p.x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(bounds.minY - 1e-6);
      expect(p.y).toBeLessThanOrEqual(bounds.maxY + 1e-6);
    }
  });

  it("TEST 3 — stops at the usable-area boundary, never partially inside the margin", () => {
    const marginBounds = { minX: 25, minY: 25, maxX: 5975, maxY: 1975 };
    const result = findNearestValidOrigin(-100, -100, 200, 200, marginBounds, [], 0);
    expect(result.x).toBeCloseTo(25, 6);
    expect(result.y).toBeCloseTo(25, 6);
  });

  it("TEST 4 — ghost stops before colliding with an existing part (no overlap)", () => {
    const obstacle = { minX: 1000, minY: 0, maxX: 1500, maxY: 500 };
    // Cursor drags the new part's bbox to try to land right on top of it.
    const result = findNearestValidOrigin(1200, 100, 500, 300, bounds, [obstacle], 0);
    const candBox = { minX: result.x, minY: result.y, maxX: result.x + 500, maxY: result.y + 300 };
    const overlaps = candBox.minX < obstacle.maxX && candBox.maxX > obstacle.minX && candBox.minY < obstacle.maxY && candBox.maxY > obstacle.minY;
    expect(overlaps).toBe(false);
    expect(result.fits).toBe(true);
  });

  it("TEST 5 — preserves the configured partGapMm as a real exclusion zone", () => {
    const gap = 25;
    const obstacle = { minX: 1000, minY: 0, maxX: 1500, maxY: 500 };
    const result = findNearestValidOrigin(1510, 100, 200, 200, bounds, [obstacle], gap);
    // The pushed-out box must clear the obstacle by at least `gap` on the
    // axis it was resolved along.
    const clearanceX = result.x - obstacle.maxX;
    const withinLeft = result.x + 200 <= obstacle.minX - gap + 1e-6;
    expect(clearanceX >= gap - 1e-6 || withinLeft).toBe(true);
  });

  it("TEST 6 — cursor sweeping across an obstacle never yields a spot that overlaps it", () => {
    const obstacle = { minX: 1000, minY: 0, maxX: 1500, maxY: 500 };
    for (let x = 900; x <= 1600; x += 25) {
      const result = findNearestValidOrigin(x, 100, 300, 300, bounds, [obstacle], 0);
      const candBox = { minX: result.x, minY: result.y, maxX: result.x + 300, maxY: result.y + 300 };
      const overlaps = candBox.minX < obstacle.maxX && candBox.maxX > obstacle.minX && candBox.minY < obstacle.maxY && candBox.maxY > obstacle.minY;
      expect(overlaps).toBe(false);
    }
  });

  it("TEST 7 — moving back to a clearly valid area is followed exactly (no obstacle nearby)", () => {
    const obstacle = { minX: 1000, minY: 0, maxX: 1500, maxY: 500 };
    const result = findNearestValidOrigin(4000, 1000, 300, 300, bounds, [obstacle], 0);
    expect(result.x).toBeCloseTo(4000, 6);
    expect(result.y).toBeCloseTo(1000, 6);
  });

  it("reports fits: false when the part is larger than the entire usable area", () => {
    const tiny = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const result = findNearestValidOrigin(0, 0, 500, 500, tiny, [], 0);
    expect(result.fits).toBe(false);
  });
});
