import { describe, expect, it } from "vitest";
import {
  SHIFT_STEP,
  circleLoop,
  flattenLoop,
  loopArea,
  loopBBox,
  loopFromBulge,
  loopLength,
  regionArea,
  regionBBox,
  regionFromPolygon,
  regionRings,
  regionToPolygon,
  ringsContain,
  ringsDistance,
  sliceRegion,
  splitRegion,
} from "./geometry";
import type { Pt, Region } from "./types";

/* ---------------- helpers ---------------- */

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const rectRegion = (x0: number, y0: number, x1: number, y1: number, holes: Pt[][] = []) =>
  regionFromPolygon(rect(x0, y0, x1, y1), holes);
const circleRegion = (cx: number, cy: number, r: number): Region => ({ outer: circleLoop(cx, cy, r), holes: [] });
const total = (rs: Region[]) => rs.reduce((s, r) => s + regionArea(r), 0);

/** Deterministic PRNG so the sampling tests are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Every sampled point (away from any boundary) must be inside exactly as many pieces
 * as it is inside the original: 1 inside, 0 outside. Detects gaps AND overlaps.
 */
function expectPartition(original: Region, pieces: Region[], n = 4000, seed = 7) {
  const rnd = mulberry32(seed);
  const [x0, y0, x1, y1] = regionBBox(original);
  const origRings = regionRings(original);
  const pieceRings = pieces.map((p) => regionRings(p));
  let checked = 0;
  for (let i = 0; i < n; i++) {
    const p: Pt = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
    const margin = Math.min(ringsDistance(origRings, p), ...pieceRings.map((r) => ringsDistance(r, p)));
    if (margin < 0.02) continue; // too close to a boundary for polygon-flattened testing
    checked++;
    const want = ringsContain(origRings, p) ? 1 : 0;
    const got = pieceRings.filter((r) => ringsContain(r, p)).length;
    if (got !== want) throw new Error(`partition mismatch at (${p[0].toFixed(3)}, ${p[1].toFixed(3)}): want ${want}, got ${got}`);
  }
  expect(checked).toBeGreaterThan(n * 0.5);
}

const segmentArea = (r: number, d: number) => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d); // cap beyond distance d

/* ---------------- construction & measurement ---------------- */

describe("loops and measurement", () => {
  it("computes polygon area and length", () => {
    const l = regionFromPolygon(rect(0, 0, 100, 50)).outer;
    expect(loopArea(l)).toBeCloseTo(5000, 9);
    expect(loopLength(l)).toBeCloseTo(300, 9);
    expect(loopBBox(l)).toEqual([0, 0, 100, 50]);
  });

  it("fixes orientation (CW outer, CCW hole)", () => {
    const cw = rect(0, 0, 100, 50).reverse();
    const ccwHole = rect(10, 10, 20, 20);
    const r = regionFromPolygon(cw, [ccwHole]);
    expect(loopArea(r.outer)).toBeGreaterThan(0);
    expect(loopArea(r.holes[0])).toBeLessThan(0);
    expect(regionArea(r)).toBeCloseTo(5000 - 100, 9);
  });

  it("integrates circle area exactly", () => {
    const r = circleRegion(5, -3, 100);
    expect(regionArea(r)).toBeCloseTo(Math.PI * 100 * 100, 6);
    expect(loopLength(r.outer)).toBeCloseTo(2 * Math.PI * 100, 9);
    const [x0, y0, x1, y1] = regionBBox(r);
    expect([x0, y0, x1, y1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-95, -103, 105, 97]);
  });

  it("builds a stadium from bulge vertices", () => {
    const loop = loopFromBulge([
      [10, 0, 0],
      [90, 0, 1],
      [90, 20, 0],
      [10, 20, 1],
    ]);
    expect(loopArea(loop)).toBeCloseTo(80 * 20 + Math.PI * 100, 6);
    expect(loop.filter((e) => e.arc).length).toBe(2);
    expect(loop[1].arc!.c[0]).toBeCloseTo(90, 9);
    expect(loop[1].arc!.c[1]).toBeCloseTo(10, 9);
  });

  it("keeps flattening within tolerance", () => {
    const tol = 0.05;
    const r = circleRegion(0, 0, 3760);
    const ring = flattenLoop(r.outer, tol);
    const maxDev = Math.max(...ring.map((p) => Math.abs(Math.hypot(p[0], p[1]) - 3760)));
    expect(maxDev).toBeLessThanOrEqual(1e-9); // vertices are on the circle
    // chord sagitta between consecutive vertices
    let worst = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      worst = Math.max(worst, 3760 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
    }
    expect(worst).toBeLessThanOrEqual(tol + 1e-9);
    const poly = regionToPolygon(r, tol);
    expect(poly.holes).toEqual([]);
  });
});

/* ---------------- polygons ---------------- */

describe("splitRegion — polygons", () => {
  it("splits a rectangle with a vertical line", () => {
    const res = splitRegion(rectRegion(0, 0, 100, 50), "x", 30);
    expect(res.low).toHaveLength(1);
    expect(res.high).toHaveLength(1);
    expect(total(res.low)).toBeCloseTo(1500, 9);
    expect(total(res.high)).toBeCloseTo(3500, 9);
    expect(res.seamLength).toBeCloseTo(50, 9);
    expect(res.seams).toHaveLength(1);
    expect(res.shifted).toBe(false);
    expect(res.areaError).toBeLessThan(1e-9);
    expect(regionBBox(res.low[0])).toEqual([0, 0, 30, 50]);
    expect(regionBBox(res.high[0])).toEqual([30, 0, 100, 50]);
  });

  it("splits a rectangle with a horizontal line", () => {
    const res = splitRegion(rectRegion(0, 0, 100, 50), "y", 20);
    expect(total(res.low)).toBeCloseTo(2000, 9);
    expect(total(res.high)).toBeCloseTo(3000, 9);
    expect(res.seamLength).toBeCloseTo(100, 9);
    expect(regionBBox(res.low[0])).toEqual([0, 0, 100, 20]);
  });

  it("gives one side only when the line misses the part", () => {
    const r = rectRegion(0, 0, 100, 50);
    const left = splitRegion(r, "x", -10);
    expect(left.low).toHaveLength(0);
    expect(left.high).toHaveLength(1);
    expect(left.seams).toHaveLength(0);
    const right = splitRegion(r, "x", 500);
    expect(right.low).toHaveLength(1);
    expect(right.high).toHaveLength(0);
  });

  it("returns several disconnected pieces for a concave U shape", () => {
    const u: Pt[] = [
      [0, 0],
      [30, 0],
      [30, 40],
      [20, 40],
      [20, 10],
      [10, 10],
      [10, 40],
      [0, 40],
    ];
    const region = regionFromPolygon(u);
    expect(regionArea(region)).toBeCloseTo(900, 9);
    const res = splitRegion(region, "y", 25);
    expect(res.low).toHaveLength(1);
    expect(res.high).toHaveLength(2);
    expect(res.seamLength).toBeCloseTo(20, 9); // two 10-wide arms
    expect(res.seams).toHaveLength(2);
    expect(total(res.low)).toBeCloseTo(30 * 10 + 2 * 10 * 15, 9);
    expect(total(res.high)).toBeCloseTo(2 * 10 * 15, 9);
    expectPartition(region, [...res.low, ...res.high]);
  });

  it("turns a crossed hole into notches (no hole loops left)", () => {
    const hole: Pt[] = rect(40, 20, 60, 30);
    const region = rectRegion(0, 0, 100, 50, [hole]);
    const res = splitRegion(region, "x", 50);
    expect(res.holesCrossed).toEqual([0]);
    expect(res.low[0].holes).toHaveLength(0);
    expect(res.high[0].holes).toHaveLength(0);
    expect(total(res.low)).toBeCloseTo(2500 - 100, 9);
    expect(total(res.high)).toBeCloseTo(2500 - 100, 9);
    expect(res.seamLength).toBeCloseTo(50 - 10, 9); // seam stops at the hole
    expect(res.seams).toHaveLength(2);
    expectPartition(region, [...res.low, ...res.high]);
  });

  it("keeps an uncrossed hole in the piece that contains it", () => {
    const region = rectRegion(0, 0, 100, 50, [rect(10, 10, 20, 20)]);
    const res = splitRegion(region, "x", 50);
    expect(res.holesCrossed).toEqual([]);
    expect(res.low[0].holes).toHaveLength(1);
    expect(res.high[0].holes).toHaveLength(0);
    expect(total(res.low)).toBeCloseTo(2500 - 100, 9);
    expect(total(res.high)).toBeCloseTo(2500, 9);
    expectPartition(region, [...res.low, ...res.high]);
  });

  it("handles a cut that coincides with an edge (policy: shifted, nothing lost)", () => {
    const region = rectRegion(0, 0, 100, 50);
    const res = splitRegion(region, "x", 100);
    expect(res.shifted).toBe(true);
    expect(res.usedPos).toBeCloseTo(100 + SHIFT_STEP, 12);
    expect(res.low).toHaveLength(1);
    expect(res.high).toHaveLength(0);
    expect(total(res.low)).toBeCloseTo(5000, 9);
  });

  it("handles a cut through a vertex", () => {
    const tri = regionFromPolygon([
      [0, 0],
      [100, 0],
      [50, 80],
    ]);
    const res = splitRegion(tri, "x", 50); // passes through the apex
    expect(res.shifted).toBe(true);
    expect(res.areaError).toBeLessThan(1e-9);
    expect(total([...res.low, ...res.high])).toBeCloseTo(4000, 9);
    expectPartition(tri, [...res.low, ...res.high]);
  });

  it("is orientation independent", () => {
    const cw = regionFromPolygon(rect(0, 0, 100, 50).reverse());
    const res = splitRegion(cw, "x", 30);
    expect(total(res.low)).toBeCloseTo(1500, 9);
  });
});

/* ---------------- arcs & circles ---------------- */

describe("splitRegion — arcs and circles", () => {
  it("cuts a circle exactly (analytic segment area)", () => {
    const r = 100;
    const d = 30;
    const res = splitRegion(circleRegion(0, 0, r), "x", d);
    const cap = segmentArea(r, d);
    expect(total(res.high)).toBeCloseTo(cap, 6);
    expect(total(res.low)).toBeCloseTo(Math.PI * r * r - cap, 6);
    expect(res.seamLength).toBeCloseTo(2 * Math.sqrt(r * r - d * d), 9);
    expect(res.areaError).toBeLessThan(1e-8);
    expect(res.shifted).toBe(false);
  });

  it("keeps arcs as arcs (no polygonization)", () => {
    const res = splitRegion(circleRegion(10, 20, 100), "x", 40);
    for (const piece of [...res.low, ...res.high]) {
      const arcs = piece.outer.filter((e) => e.arc);
      const lines = piece.outer.filter((e) => !e.arc);
      expect(arcs.length).toBeGreaterThanOrEqual(1);
      expect(lines).toHaveLength(1); // only the seam chord is straight
      for (const e of arcs) {
        expect(e.arc!.r).toBe(100);
        expect(e.arc!.c).toEqual([10, 20]);
      }
    }
  });

  it("mates the seam exactly on both sides", () => {
    const res = splitRegion(circleRegion(0, 0, 100), "y", 25);
    const chord = (r: Region) => r.outer.find((e) => !e.arc)!;
    const lo = chord(res.low[0]);
    const hi = chord(res.high[0]);
    expect([lo.a, lo.b]).toEqual([hi.b, hi.a]); // identical points, opposite direction
  });

  it("handles a cut through the circle centre line (vertex on the line → shifted)", () => {
    const res = splitRegion(circleRegion(0, 0, 100), "y", 0);
    expect(res.shifted).toBe(true);
    expect(res.areaError).toBeLessThan(1e-8);
    expect(total(res.low) + total(res.high)).toBeCloseTo(Math.PI * 1e4, 6);
    // the shift moves a strip of width SHIFT_STEP × chord 2r from one half to the other
    expect(Math.abs(total(res.low) - total(res.high))).toBeCloseTo(4 * 100 * SHIFT_STEP, 6);
  });

  it("cuts a circular hole in half, both halves keep the arc", () => {
    const hole = circleLoop(50, 25, 10, false);
    const region: Region = { outer: regionFromPolygon(rect(0, 0, 100, 50)).outer, holes: [hole] };
    const res = splitRegion(region, "x", 50);
    expect(res.holesCrossed).toEqual([0]);
    const half = (Math.PI * 100) / 2;
    expect(total(res.low)).toBeCloseTo(2500 - half, 6);
    expect(total(res.high)).toBeCloseTo(2500 - half, 6);
    expect(res.low[0].holes).toHaveLength(0);
    expect(res.low[0].outer.some((e) => e.arc && e.arc.r === 10)).toBe(true);
    expect(res.seamLength).toBeCloseTo(50 - 20, 9);
    expectPartition(region, [...res.low, ...res.high]);
  });

  it("cuts a stadium (arcs + lines) into valid pieces", () => {
    const stadium: Region = {
      outer: loopFromBulge([
        [10, 0, 0],
        [90, 0, 1],
        [90, 20, 0],
        [10, 20, 1],
      ]),
      holes: [circleLoop(50, 10, 4, false)],
    };
    const area = regionArea(stadium);
    expect(area).toBeCloseTo(1600 + Math.PI * 100 - Math.PI * 16, 6);
    const res = sliceRegion(stadium, "x", [5.5, 33, 77]);
    expect(res.strips).toHaveLength(4);
    const all = res.strips.flat();
    expect(total(all)).toBeCloseTo(area, 6);
    expect(res.areaError).toBeLessThan(1e-8);
    expectPartition(stadium, all, 5000);
  });
});

/* ---------------- strips: the Ø7520 case ---------------- */

describe("sliceRegion — Ø7520 circle into 1500 strips", () => {
  const R = 3760;
  const circle = circleRegion(0, 0, R);
  const cuts = [-3000, -1500, 0, 1500, 3000];

  it("gives 6 strips, none taller than 1500, area preserved", () => {
    const res = sliceRegion(circle, "y", cuts);
    expect(res.strips).toHaveLength(6);
    expect(res.strips.every((s) => s.length === 1)).toBe(true);
    for (const [i, s] of res.strips.entries()) {
      const [, y0, , y1] = regionBBox(s[0]);
      expect(y1 - y0).toBeLessThanOrEqual(1500 + 2 * SHIFT_STEP);
      if (i === 0 || i === 5) expect(y1 - y0).toBeCloseTo(760, 3);
    }
    expect(total(res.strips.flat())).toBeCloseTo(Math.PI * R * R, 4);
    expect(res.areaError).toBeLessThan(1e-6);
  });

  it("reports seam lengths and flags the degenerate centre cut", () => {
    const res = sliceRegion(circle, "y", cuts);
    const chordAt = (y: number) => 2 * Math.sqrt(R * R - y * y);
    expect(res.cuts[0].seamLength).toBeCloseTo(chordAt(3000), 6);
    expect(res.cuts[1].seamLength).toBeCloseTo(chordAt(1500), 6);
    expect(res.cuts[2].shifted).toBe(true);
    expect(res.cuts[2].seamLength).toBeCloseTo(2 * R, 3);
    expect(res.cuts[0].shifted).toBe(false);
  });

  it("every strip is an exact circular segment region (arcs kept)", () => {
    const res = sliceRegion(circle, "y", cuts);
    for (const s of res.strips) {
      expect(s[0].outer.some((e) => e.arc && e.arc.r === R)).toBe(true);
    }
  });

  it("covers the circle with no gaps or overlaps", () => {
    const res = sliceRegion(circle, "y", cuts);
    expectPartition(circle, res.strips.flat(), 6000);
  });
});

/* ---------------- multi-cut ---------------- */

describe("sliceRegion", () => {
  it("cuts a rectangle into strips", () => {
    const region = rectRegion(0, 0, 6000, 1000);
    const res = sliceRegion(region, "x", [1500, 3000, 4500]);
    expect(res.strips.map((s) => total(s))).toEqual([1500e3, 1500e3, 1500e3, 1500e3].map((v) => expect.closeTo(v, 6)));
    expect(res.cuts.every((c) => c.seamLength === 1000)).toBe(true);
  });

  it("rejects unordered or too-close cut positions", () => {
    const region = rectRegion(0, 0, 100, 100);
    expect(() => sliceRegion(region, "x", [50, 40])).toThrow();
    expect(() => sliceRegion(region, "x", [50, 50.0001])).toThrow();
  });

  it("splits a concave part across several cuts into more pieces than strips", () => {
    // comb: base with 3 teeth
    const comb: Pt[] = [
      [0, 0],
      [50, 0],
      [50, 30],
      [40, 30],
      [40, 10],
      [30, 10],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    const region = regionFromPolygon(comb);
    const res = sliceRegion(region, "y", [20]);
    expect(res.strips[0]).toHaveLength(1);
    expect(res.strips[1]).toHaveLength(3);
    expect(total(res.strips.flat())).toBeCloseTo(regionArea(region), 9);
    expectPartition(region, res.strips.flat());
  });

  it("works for irregular polygons with a hole, cut both ways", () => {
    const poly: Pt[] = [
      [0, 0],
      [120, 10],
      [150, 60],
      [90, 100],
      [40, 85],
      [-10, 50],
    ];
    const region = regionFromPolygon(poly, [
      [
        [60, 40],
        [90, 40],
        [90, 60],
        [60, 60],
      ],
    ]);
    for (const axis of ["x", "y"] as const) {
      const res = sliceRegion(region, axis, axis === "x" ? [30, 75, 110] : [25, 55, 80]);
      expect(total(res.strips.flat())).toBeCloseTo(regionArea(region), 8);
      expectPartition(region, res.strips.flat(), 5000);
    }
  });
});
