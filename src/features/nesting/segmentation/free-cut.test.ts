import { describe, expect, it } from "vitest";
import { circleLoop, regionArea, regionFromPolygon, normalizeRegion } from "./geometry";
import {
  distanceToPath,
  extendPath,
  pathSelfIntersects,
  sharedSegments,
  simplifyPath,
  splitRegionByPath,
  splitRegionsByPath,
} from "./free-cut";
import type { Pt, Region } from "./types";

const square = (s = 100): Region => regionFromPolygon([[0, 0], [s, 0], [s, s], [0, s]]);
const disc = (r = 100): Region => normalizeRegion({ outer: circleLoop(0, 0, r), holes: [] });
const ring = (R = 100, r = 40): Region => normalizeRegion({ outer: circleLoop(0, 0, R), holes: [circleLoop(0, 0, r, false)] });
const total = (rs: Region[]) => rs.reduce((s, r) => s + regionArea(r), 0);
const hasArc = (r: Region) => r.outer.some((e) => e.arc);

describe("simplifyPath / pathSelfIntersects / extendPath", () => {
  it("drops repeated and nearly collinear points but keeps the corners", () => {
    const out = simplifyPath([[0, 0], [0, 0], [5, 0.1], [10, 0], [10, 10]], 0.5);
    expect(out).toEqual([[0, 0], [10, 0], [10, 10]]);
  });
  it("detects a line that crosses, touches or folds back on itself", () => {
    expect(pathSelfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true); // bow-tie
    expect(pathSelfIntersects([[0, 0], [10, 0], [5, 0]])).toBe(true); // folds back
    expect(pathSelfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(false); // a C-shape
  });
  it("extends both ends along their last segment", () => {
    const e = extendPath([[0, 0], [10, 0], [10, 10]], 100);
    expect(e[0]).toEqual([-100, 0]);
    expect(e[e.length - 1][0]).toBeCloseTo(10);
    expect(e[e.length - 1][1]).toBeCloseTo(110);
    expect(e).toHaveLength(5);
  });
  it("measures the distance to a polyline", () => {
    expect(distanceToPath([[0, 0], [10, 0]], [5, 3])).toBeCloseTo(3);
  });
});

describe("splitRegionByPath", () => {
  it("cuts a square with a bent line into two pieces that add up", () => {
    const path = extendPath([[50, -10], [60, 50], [40, 110]], 500);
    const r = splitRegionByPath(square(), path);
    expect(r.pieces).toHaveLength(2);
    expect(total(r.pieces)).toBeCloseTo(10000, 6);
    expect(r.areaError).toBeLessThan(1e-6);
    expect(r.chords).toHaveLength(1);
    expect(r.seamLength).toBeGreaterThan(100); // longer than the straight 100 mm because the line bends
    expect(r.shifted).toBe(false);
    for (const p of r.pieces) expect(regionArea(p)).toBeGreaterThan(0);
  });

  it("keeps arcs exact when a circle is cut by a curved line", () => {
    const path = extendPath([[-150, -20], [-40, 30], [40, -30], [150, 20]], 1000);
    const r = splitRegionByPath(disc(), path);
    expect(r.pieces).toHaveLength(2);
    expect(total(r.pieces)).toBeCloseTo(Math.PI * 100 * 100, 6);
    expect(r.pieces.every(hasArc)).toBe(true);
    expect(r.areaError).toBeLessThan(1e-6);
  });

  it("cuts a ring through its hole: two pieces, the hole is reported", () => {
    const r = splitRegionByPath(ring(), extendPath([[-200, 10], [200, 10]], 1000));
    expect(r.pieces).toHaveLength(2);
    expect(r.holesCrossed).toEqual([0]);
    expect(r.chords).toHaveLength(2); // one seam on each side of the hole
    expect(total(r.pieces)).toBeCloseTo(Math.PI * (100 * 100 - 40 * 40), 5);
    expect(r.areaError).toBeLessThan(1e-5);
  });

  it("leaves a hole the line does not touch with the piece that contains it", () => {
    const part = normalizeRegion({
      outer: regionFromPolygon([[0, 0], [100, 0], [100, 100], [0, 100]]).outer,
      holes: [regionFromPolygon([[10, 10], [30, 10], [30, 30], [10, 30]]).outer],
    });
    const r = splitRegionByPath(part, extendPath([[60, -20], [60, 120]], 1000));
    expect(r.pieces).toHaveLength(2);
    expect(r.holesCrossed).toEqual([]);
    expect(r.pieces.map((p) => p.holes.length).sort()).toEqual([0, 1]);
    expect(total(r.pieces)).toBeCloseTo(10000 - 400, 6);
  });

  it("gives three pieces when a line crosses a U-shape twice", () => {
    const U = regionFromPolygon([[0, 0], [90, 0], [90, 100], [60, 100], [60, 30], [30, 30], [30, 100], [0, 100]]);
    const r = splitRegionByPath(U, extendPath([[-20, 60], [120, 60]], 1000));
    expect(r.pieces).toHaveLength(3);
    expect(r.chords).toHaveLength(2);
    expect(total(r.pieces)).toBeCloseTo(regionArea(U), 6);
  });

  it("returns the region unchanged when the line misses it", () => {
    const r = splitRegionByPath(square(), extendPath([[200, 0], [200, 100]], 1000));
    expect(r.pieces).toHaveLength(1);
    expect(r.seamLength).toBe(0);
  });

  it("moves a line that passes exactly through a vertex by a tiny step", () => {
    const r = splitRegionByPath(square(), extendPath([[-50, -50], [150, 150]], 1000)); // through two corners
    expect(r.shifted).toBe(true);
    expect(r.pieces).toHaveLength(2);
    expect(total(r.pieces)).toBeCloseTo(10000, 4);
  });

  it("moves a line that runs along an edge", () => {
    const r = splitRegionByPath(square(), extendPath([[-50, 100], [150, 100]], 1000));
    // the line lies on the top edge: after the shift it either misses or slices off ~0 area; it must not crash or lose area
    expect(total(r.pieces)).toBeCloseTo(10000, 3);
  });

  it("uses one shift for several regions so neighbours still mate", () => {
    const a = regionFromPolygon([[0, 0], [100, 0], [100, 50], [0, 50]]);
    const b = regionFromPolygon([[0, 50], [100, 50], [100, 100], [0, 100]]);
    const r = splitRegionsByPath([a, b], extendPath([[-50, -50], [150, 150]], 1000));
    expect(r.parts).toHaveLength(2);
    expect(r.parts.every((p) => p.pieces.length >= 1)).toBe(true);
    expect(total(r.parts.flatMap((p) => p.pieces))).toBeCloseTo(10000, 4);
  });

  it("refuses a path that starts inside the part", () => {
    expect(() => splitRegionByPath(square(), [[50, 50], [200, 50]])).toThrow(/outside/);
  });

  it("handles cuts that cross each other (applied one after the other)", () => {
    let pieces: Region[] = [disc()];
    for (const raw of [
      [[-150, 5], [150, -5]],
      [[3, -150], [-3, 150]],
    ] as Pt[][]) {
      const res = splitRegionsByPath(pieces, extendPath(raw, 1000));
      pieces = res.parts.flatMap((p) => p.pieces);
    }
    expect(pieces).toHaveLength(4);
    expect(total(pieces)).toBeCloseTo(Math.PI * 100 * 100, 5);
    expect(pieces.every(hasArc)).toBe(true);
  });

  it("finds the seam between the two halves", () => {
    const r = splitRegionByPath(square(), extendPath([[50, -10], [50, 110]], 1000));
    const seam = sharedSegments(r.pieces[0], r.pieces[1]);
    const len = seam.reduce((s, [p, q]) => s + Math.hypot(q[0] - p[0], q[1] - p[1]), 0);
    expect(len).toBeCloseTo(100, 6);
  });
});
