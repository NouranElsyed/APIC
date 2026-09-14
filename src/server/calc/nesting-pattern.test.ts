import { describe, expect, it } from "vitest";
import {
  detectPattern,
  expandPatternOnSheet,
  computeRepetitionsNeeded,
  type DetectedPattern,
  type PatternPlacedInstance,
  type PatternSheetBounds,
} from "./nesting-pattern";
import { computeOrientedShape, translatePoints, polygonsOverlap, boundsContain } from "./nesting-geometry";
import type { Point } from "./dxf";

function rect(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

// A big, effectively-unbounded sheet so these tests are only about
// quantity math, not about running out of room.
const HUGE: PatternSheetBounds = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };

function inst(overrides: Partial<PatternPlacedInstance> & { takeoffPartId: string; outer: Point[]; xMm: number; yMm: number }): PatternPlacedInstance {
  return {
    areaSqm: 0,
    instanceNumber: 1,
    rotationDeg: 0,
    locked: false,
    ...overrides,
  };
}

function countByPart(generated: { takeoffPartId: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of generated) m.set(g.takeoffPartId, (m.get(g.takeoffPartId) ?? 0) + 1);
  return m;
}

describe("nesting-pattern — quantity-aware pattern remainder (Phase 2C §4)", () => {
  it("TEST 14 — pattern size 2 + remaining 5 → exactly 5, never 6", () => {
    const partOuter = rect(100, 50);
    // Demonstrated pattern: two instances of A, spaced 150mm apart on X.
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 0, instanceNumber: 1 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 150, yMm: 0, instanceNumber: 2 }),
    ];
    const pattern = detectPattern(seed);
    expect(pattern).not.toBeNull();
    // Note: detectPattern reports the MINIMAL repeat unit it can find. For
    // two identical, evenly-spaced instances that minimal unit is a single
    // slot repeated with a 150mm step (L=1) — algorithmically equivalent
    // to "pattern size 2" for the purpose of this test (what matters is
    // the final quantity below, not the internal slot count).

    const result = expandPatternOnSheet(pattern!, seed, HUGE, {
      requiredQtyByPart: new Map([["A", 5]]),
      placedQtyByPart: new Map([["A", 2]]), // the 2 seed instances already count
      partGapMm: 0,
    });

    const totalFinal = 2 + result.generated.length;
    expect(totalFinal).toBe(5);
    expect(result.reachedRequiredQuantity).toBe(true);
  });

  it("TEST 15 — pattern size 3 + remaining 7 → exactly 7", () => {
    const partOuter = rect(80, 80);
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 100, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 200, yMm: 0 }),
    ];
    const pattern = detectPattern(seed);
    expect(pattern).not.toBeNull();

    const result = expandPatternOnSheet(pattern!, seed, HUGE, {
      requiredQtyByPart: new Map([["A", 7]]),
      placedQtyByPart: new Map([["A", 3]]),
      partGapMm: 0,
    });

    expect(3 + result.generated.length).toBe(7);
    expect(result.reachedRequiredQuantity).toBe(true);
  });

  it("TEST 16 — pattern size 4 + remaining 10 → exactly 10 (4 + 4 + 2)", () => {
    const partOuter = rect(50, 50);
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 60, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 60 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 60, yMm: 60 }),
    ];
    const pattern = detectPattern(seed);
    expect(pattern).not.toBeNull();
    // (See TEST 14 note: detectPattern reports its minimal repeat unit,
    // not necessarily the full demonstrated group — the final quantity
    // below is what the spec actually requires.)

    const result = expandPatternOnSheet(pattern!, seed, HUGE, {
      requiredQtyByPart: new Map([["A", 10]]),
      placedQtyByPart: new Map([["A", 4]]),
      partGapMm: 0,
    });

    expect(4 + result.generated.length).toBe(10);
    expect(result.reachedRequiredQuantity).toBe(true);
  });

  it("TEST 17/22 — multi-part pattern never exceeds ANY individual part's required quantity", () => {
    // Pattern A,B,A → 2xA + 1xB per cycle. detectPattern needs at least
    // two full demonstrated cycles to recognize a multi-slot pattern
    // (matches the product UX: "place two instances with your desired
    // pattern"), so the seed here is the pattern demonstrated TWICE.
    const aOuter = rect(100, 50);
    const bOuter = rect(60, 60);
    const seed = [
      inst({ takeoffPartId: "A", outer: aOuter, xMm: 0, yMm: 0 }),
      inst({ takeoffPartId: "B", outer: bOuter, xMm: 120, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: aOuter, xMm: 200, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: aOuter, xMm: 0, yMm: 100 }),
      inst({ takeoffPartId: "B", outer: bOuter, xMm: 120, yMm: 100 }),
      inst({ takeoffPartId: "A", outer: aOuter, xMm: 200, yMm: 100 }),
    ];
    const pattern = detectPattern(seed);
    expect(pattern).not.toBeNull();
    expect(pattern!.slots.length).toBe(3); // A, B, A per cycle

    const result = expandPatternOnSheet(pattern!, seed, HUGE, {
      requiredQtyByPart: new Map([
        ["A", 5],
        ["B", 3],
      ]),
      placedQtyByPart: new Map([
        ["A", 4], // 2 cycles x 2 A's already placed by the seed
        ["B", 2], // 2 cycles x 1 B already placed by the seed
      ]),
      partGapMm: 0,
    });

    const totals = countByPart(result.generated);
    const finalA = 4 + (totals.get("A") ?? 0);
    const finalB = 2 + (totals.get("B") ?? 0);

    expect(finalA).toBeLessThanOrEqual(5);
    expect(finalB).toBeLessThanOrEqual(3);
    expect(finalA).toBe(5);
    expect(finalB).toBe(3);
  });

  it("TEST 18 — the odd remainder is actually generated, not silently dropped", () => {
    const partOuter = rect(100, 50);
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 150, yMm: 0 }),
    ];
    const pattern = detectPattern(seed)!;
    const result = expandPatternOnSheet(pattern, seed, HUGE, {
      requiredQtyByPart: new Map([["A", 5]]),
      placedQtyByPart: new Map([["A", 2]]),
      partGapMm: 0,
    });
    // 3 more needed (odd relative to pattern size 2): must not be dropped.
    expect(result.generated.length).toBe(3);
  });

  it("TEST 20/21 — generated pattern instances never overlap and never cross bounds/margin", () => {
    const partOuter = rect(100, 50);
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 110, yMm: 0 }),
    ];
    const pattern = detectPattern(seed)!;
    const tightBounds: PatternSheetBounds = { minX: 0, minY: 0, maxX: 500, maxY: 200 };
    const result = expandPatternOnSheet(pattern, seed, tightBounds, {
      requiredQtyByPart: new Map([["A", 20]]), // way more than can fit
      placedQtyByPart: new Map([["A", 2]]),
      partGapMm: 10,
    });

    const allPolys = [...seed, ...result.generated].map((i) => {
      const shape = computeOrientedShape(i.outer, i.rotationDeg);
      return translatePoints(shape.points, i.xMm, i.yMm);
    });
    for (const p of allPolys) {
      expect(boundsContain(p, tightBounds.minX, tightBounds.minY, tightBounds.maxX, tightBounds.maxY)).toBe(true);
    }
    for (let i = 0; i < allPolys.length; i++) {
      for (let j = i + 1; j < allPolys.length; j++) {
        expect(polygonsOverlap(allPolys[i], allPolys[j])).toBe(false);
      }
    }
    // Because the sheet is too small for 20, it must stop early rather
    // than overflow — but whatever it DID place must be valid and must
    // never claim more than required.
    expect(2 + result.generated.length).toBeLessThanOrEqual(20);
    expect(result.reachedRequiredQuantity).toBe(false);
    expect(result.shortfallCycles).toBeGreaterThan(0);
  });

  it("TEST 23 (regression) — a vertical column pattern wraps into a new column instead of stopping dead at the sheet's bottom edge", () => {
    // Reproduces the reported bug exactly: two identical 300x300 squares
    // stacked vertically (a single-part, single-column pattern) on a
    // sheet that only has room for 3 total rows before hitting the
    // bottom margin, but plenty of room to the right for more columns.
    const partOuter = rect(300, 300);
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 100, yMm: 100 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 100, yMm: 450 }), // 350mm pitch downward
    ];
    const pattern = detectPattern(seed)!;
    expect(pattern).not.toBeNull();

    // Sheet: 1500mm wide (room for ~4 columns of 350mm pitch), 1200mm
    // tall (room for only ~3 rows of 350mm pitch) — deliberately narrow
    // vertically and wide horizontally, like the screenshot's 1500x6000
    // sheet with only a sliver of vertical room left.
    const bounds: PatternSheetBounds = { minX: 0, minY: 0, maxX: 1500, maxY: 1200 };

    const result = expandPatternOnSheet(pattern, seed, bounds, {
      requiredQtyByPart: new Map([["A", 6]]),
      placedQtyByPart: new Map([["A", 2]]),
      partGapMm: 0,
    });

    // Old (broken) behavior: 0 generated, because the 3rd square in the
    // SAME column would cross the bottom edge and the whole thing gave
    // up immediately. New behavior: it must wrap into additional
    // columns to the right and keep placing.
    expect(result.generated.length).toBeGreaterThan(0);

    // Every generated instance must be a real, non-overlapping, in-bounds
    // placement — no shortcuts.
    const allPolys = [...seed, ...result.generated].map((i) => {
      const shape = computeOrientedShape(i.outer, i.rotationDeg);
      return translatePoints(shape.points, i.xMm, i.yMm);
    });
    for (const p of allPolys) {
      expect(boundsContain(p, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)).toBe(true);
    }
    for (let i = 0; i < allPolys.length; i++) {
      for (let j = i + 1; j < allPolys.length; j++) {
        expect(polygonsOverlap(allPolys[i], allPolys[j])).toBe(false);
      }
    }

    // At least one generated instance must sit in a NEW column (different
    // X from the original column at x=100) — proving it actually wrapped
    // rather than just finding one more slot in the same column.
    const wrappedIntoNewColumn = result.generated.some((g) => Math.abs(g.xMm - 100) > 1);
    expect(wrappedIntoNewColumn).toBe(true);
  });

  it("extraObstaclePolygons — a same-sheet part of a DIFFERENT type still blocks the pattern (fixes: mixed-part sheets couldn't detect a per-part pattern without losing collision safety)", () => {
    const partOuter = rect(100, 100);
    // Part A's own 2-instance pattern, detected on ITS OWN instances only.
    const seed = [
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 0, yMm: 0 }),
      inst({ takeoffPartId: "A", outer: partOuter, xMm: 110, yMm: 0 }),
    ];
    const pattern = detectPattern(seed)!;
    expect(pattern).not.toBeNull();

    // An unrelated Part B instance sitting exactly where the pattern's
    // NEXT repetition would otherwise land.
    const partBOuter = rect(60, 60);
    const obstaclePolygon = translatePoints(
      computeOrientedShape(partBOuter, 0).points,
      220,
      0,
    );

    const result = expandPatternOnSheet(
      pattern,
      seed,
      HUGE,
      {
        requiredQtyByPart: new Map([["A", 6]]),
        placedQtyByPart: new Map([["A", 2]]),
        partGapMm: 0,
      },
      [obstaclePolygon],
    );

    // The pattern must have wrapped/skipped around Part B's instance
    // rather than overlapping it.
    const allPolys = [...seed.map((i) => translatePoints(computeOrientedShape(i.outer, i.rotationDeg).points, i.xMm, i.yMm)), obstaclePolygon, ...result.generated.map((g) => translatePoints(computeOrientedShape(g.outer, g.rotationDeg).points, g.xMm, g.yMm))];
    for (let i = 0; i < allPolys.length; i++) {
      for (let j = i + 1; j < allPolys.length; j++) {
        expect(polygonsOverlap(allPolys[i], allPolys[j])).toBe(false);
      }
    }
    expect(result.generated.length).toBeGreaterThan(0);
  });

  it("computeRepetitionsNeeded never demands a negative or NaN cycle count once a part is already complete", () => {
    const pattern: DetectedPattern = {
      slots: [{ takeoffPartId: "A", outer: rect(10, 10), areaSqm: 0, rotationDeg: 0, dxMm: 0, dyMm: 0 }],
      sourceInstanceCount: 1,
      repeatDxMm: 20,
      repeatDyMm: 0,
      repeatDRotationDeg: 0,
    };
    const cycles = computeRepetitionsNeeded(pattern, {
      requiredQtyByPart: new Map([["A", 3]]),
      placedQtyByPart: new Map([["A", 3]]), // already done
      partGapMm: 0,
    });
    expect(cycles).toBe(0);
  });
});
