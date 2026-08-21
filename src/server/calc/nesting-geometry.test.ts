import { describe, expect, it } from "vitest";
import { computeOrientedShape, polygonsOverlap, translatePoints } from "./nesting-geometry";
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
