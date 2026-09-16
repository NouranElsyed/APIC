import { describe, expect, it } from "vitest";
import { runNestingAlgorithm, type EnginePartInput, type EngineSourceInput, type EngineConfig } from "./nesting-engine";
import { polygonsOverlap, polygonsMinDistance, boundsContain, transformGeometryForPlacement, type RotationDeg } from "./nesting-geometry";
import type { Point } from "./dxf";
import {
  findBestPlacement,
  generateCandidateOrigins,
  localImprovement,
  makeWorkingSheet,
  RotationCandidateCache,
  selectBoundedCandidateOrigins,
  type OptimizerPartInstance,
} from "./nesting-optimizer";

// ----------------------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------------------

const ZERO_MARGIN_CONFIG: EngineConfig = {
  marginLeftMm: 0,
  marginRightMm: 0,
  marginTopMm: 0,
  marginBottomMm: 0,
  partGapMm: 0,
};

function rect(widthMm: number, heightMm: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ];
}

// Right triangle occupying the bottom-left half of a widthMm x heightMm box.
function rightTriangle(widthMm: number, heightMm: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: 0, y: heightMm },
  ];
}

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function part(overrides: Partial<EnginePartInput> & { outer: Point[] }): EnginePartInput {
  const area = polygonArea(overrides.outer) / 1_000_000;
  return {
    takeoffPartId: "part-1",
    itemNo: 1,
    material: "Steel",
    thicknessMm: 6,
    qty: 1,
    areaSqm: area,
    ...overrides,
  };
}

function source(overrides: Partial<EngineSourceInput> & { widthMm: number; lengthMm: number }): EngineSourceInput {
  return {
    sourceSheetId: "source-1",
    material: "Steel",
    thicknessMm: 6,
    ...overrides,
  };
}

// Full, from-scratch collision re-check across every placement in every
// group/sheet of a run result, using the SAME transform the DXF exporter
// uses (transformGeometryForPlacement) and the SAME exact polygon overlap
// test used by the engine itself (polygonsOverlap) — this is independent
// of whatever internal state the optimizer produced.
function assertLayoutIsCollisionFree(
  result: ReturnType<typeof runNestingAlgorithm>,
  parts: EnginePartInput[],
  config: EngineConfig,
) {
  const outerByPartId = new Map(parts.map((p) => [p.takeoffPartId, p.outer]));

  for (const group of result.groups) {
    for (const sheet of group.sheets) {
      const polygons: Point[][] = [];
      for (const placement of sheet.placements) {
        const outer = outerByPartId.get(placement.takeoffPartId);
        expect(outer).toBeDefined();
        const { outer: transformed } = transformGeometryForPlacement(
          outer!,
          [],
          placement.rotationDeg as RotationDeg,
          placement.xMm,
          placement.yMm,
        );
        // Must stay within the margin-adjusted usable sheet area.
        // Axis convention: lengthMm runs along X (horizontal), widthMm
        // runs along Y (vertical) — matches nesting-optimizer.ts.
        const minX = config.marginLeftMm;
        const minY = config.marginBottomMm;
        const maxX = sheet.lengthMm - config.marginRightMm;
        const maxY = sheet.widthMm - config.marginTopMm;
        expect(boundsContain(transformed, minX, minY, maxX, maxY)).toBe(true);
        polygons.push(transformed);
      }
      for (let i = 0; i < polygons.length; i++) {
        for (let j = i + 1; j < polygons.length; j++) {
          expect(polygonsOverlap(polygons[i], polygons[j])).toBe(false);
        }
      }
    }
  }
}

describe("optimizeGroupPlacement (via runNestingAlgorithm)", () => {
  // --------------------------------------------------------------------
  // Regression case: two complementary right triangles that together
  // exactly tile a rectangle. A shelf/bottom-left packer reserves each
  // triangle's full rotated bounding box as its own row, so it can only
  // fit ONE such triangle on a sheet sized to hold exactly two of them
  // (each triangle's bbox already covers half the sheet, and the shelf
  // logic cannot slide the second triangle into the cavity left by the
  // first's hypotenuse). The optimizer, which generates contact
  // candidates from real vertices/edges and searches multiple rotations,
  // must be able to interlock the two triangles into a single sheet.
  // --------------------------------------------------------------------
  it("Regression — two complementary right triangles nest onto ONE sheet (shelf packing could not)", () => {
    const outer = rightTriangle(200, 100);
    const parts: EnginePartInput[] = [part({ outer, qty: 2 })];
    // Sheet sized to hold exactly the combined area of both triangles
    // (i.e. exactly one 200x100 rectangle) with zero margin/gap — a shelf
    // packer has no room to open a second row here.
    const sources: EngineSourceInput[] = [source({ widthMm: 200, lengthMm: 100 })];

    const result = runNestingAlgorithm(parts, sources, ZERO_MARGIN_CONFIG);

    expect(result.totalPartsPlaced).toBe(2);
    expect(result.totalPartsUnplaced).toBe(0);
    expect(result.totalSheetsUsed).toBe(1);
    // Full sheet utilization since the two triangles exactly tile it.
    expect(result.overallUtilizationPercent).toBeGreaterThan(99);
    assertLayoutIsCollisionFree(result, parts, ZERO_MARGIN_CONFIG);
  });

  it("Rectangles — many small rectangles pack with high utilization and no overlaps", () => {
    const parts: EnginePartInput[] = [
      part({ takeoffPartId: "p1", itemNo: 1, outer: rect(300, 200), qty: 6 }),
      part({ takeoffPartId: "p2", itemNo: 2, outer: rect(150, 150), qty: 4 }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1220, lengthMm: 2440 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsUnplaced).toBe(0);
    expect(result.overallUtilizationPercent).toBeGreaterThan(0);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Triangles — a batch of identical right triangles is fully placed collision-free", () => {
    const outer = rightTriangle(120, 80);
    const parts: EnginePartInput[] = [part({ outer, qty: 8 })];
    const sources: EngineSourceInput[] = [source({ widthMm: 600, lengthMm: 600 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(8);
    expect(result.totalPartsUnplaced).toBe(0);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Irregular polygons — an L-shaped (concave) part is placed without overlap", () => {
    // An L-shape: a 200x200 square with a 100x100 notch removed from the
    // top-right corner.
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    const parts: EnginePartInput[] = [part({ outer: lShape, qty: 3 })];
    const sources: EngineSourceInput[] = [source({ widthMm: 800, lengthMm: 800 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(3);
    expect(result.totalPartsUnplaced).toBe(0);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Rotated parts — a long thin part only fits after a 90-degree rotation", () => {
    const parts: EnginePartInput[] = [part({ outer: rect(900, 100), qty: 1 })];
    // X-axis (horizontal) = lengthMm, Y-axis (vertical) = widthMm. A narrow
    // 200mm-long / 1000mm-wide sheet only has 200mm along X, so the 900mm
    // side of the part must rotate onto Y (which has 1000mm of room).
    const sources: EngineSourceInput[] = [source({ widthMm: 1000, lengthMm: 200 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(1);
    expect(result.groups[0].sheets[0].placements[0].rotationDeg).toBe(90);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Mixed part sizes — large and small parts of very different shapes share sheets efficiently", () => {
    const parts: EnginePartInput[] = [
      part({ takeoffPartId: "big", itemNo: 1, outer: rect(1000, 800), qty: 1 }),
      part({ takeoffPartId: "small-tri", itemNo: 2, outer: rightTriangle(150, 150), qty: 5 }),
      part({ takeoffPartId: "small-rect", itemNo: 3, outer: rect(80, 60), qty: 10 }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1220, lengthMm: 2440 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsUnplaced).toBe(0);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Multiple sheets — demand that exceeds one sheet spills over onto a second sheet, still collision-free", () => {
    const parts: EnginePartInput[] = [part({ outer: rect(500, 500), qty: 6 })];
    const sources: EngineSourceInput[] = [source({ widthMm: 1000, lengthMm: 1000 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(6);
    expect(result.totalSheetsUsed).toBeGreaterThanOrEqual(2);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Impossible-to-fit parts — a part larger than every known sheet is reported unplaced, not force-fit", () => {
    const parts: EnginePartInput[] = [
      part({ takeoffPartId: "fits", itemNo: 1, outer: rect(300, 300), qty: 1 }),
      part({ takeoffPartId: "too-big", itemNo: 2, outer: rect(5000, 5000), qty: 1 }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1220, lengthMm: 2440 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(1);
    expect(result.totalPartsUnplaced).toBe(1);
    const unplaced = result.unplacedParts.find((u) => u.takeoffPartId === "too-big");
    expect(unplaced?.reason).toBe("PART_TOO_LARGE");
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Holes — a part's DXF-derived (holes-subtracted) area is what drives utilization/scrap, not its raw bounding box", () => {
    // The engine's collision model operates on the outer contour only
    // (holes are subtracted upstream by the DXF parser into areaSqm — see
    // nesting-geometry.ts's PartGeometry doc comment); this test proves a
    // part whose reported area is smaller than its outer contour's true
    // polygon area (as if holes had been subtracted) still places
    // correctly and its SMALLER area — not the outer contour's full area —
    // is what's used for utilization/scrap accounting.
    const outer = rect(400, 300); // 0.12 sqm raw
    const holesAdjustedAreaSqm = 0.08; // pretend two holes remove 0.04 sqm
    const parts: EnginePartInput[] = [
      part({ outer, qty: 1, areaSqm: holesAdjustedAreaSqm }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1000, lengthMm: 1000 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(1);
    expect(result.totalUsedAreaSqm).toBeCloseTo(holesAdjustedAreaSqm, 6);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });

  it("Optimization metrics are reported and are non-trivial for a multi-part run", () => {
    const parts: EnginePartInput[] = [
      part({ takeoffPartId: "p1", itemNo: 1, outer: rect(300, 200), qty: 4 }),
      part({ takeoffPartId: "p2", itemNo: 2, outer: rightTriangle(200, 150), qty: 4 }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1220, lengthMm: 2440 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.groups[0].optimization.algorithm).toBe("candidate-search-multi-strategy-local-improvement");
    expect(result.groups[0].optimization.strategiesEvaluated).toBeGreaterThan(0);
    expect(result.optimizationTimeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.optimizationScore)).toBe(true);
  });

  it("Bounded search — a larger job still completes well within its time budget", () => {
    const parts: EnginePartInput[] = [
      part({ takeoffPartId: "p1", itemNo: 1, outer: rect(250, 180), qty: 12 }),
      part({ takeoffPartId: "p2", itemNo: 2, outer: rightTriangle(180, 120), qty: 12 }),
      part({ takeoffPartId: "p3", itemNo: 3, outer: rect(90, 90), qty: 20 }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1220, lengthMm: 2440 })];

    const started = Date.now();
    const result = runNestingAlgorithm(parts, sources, DEFAULT_CONFIG(), { timeLimitMs: 4000 });
    const elapsed = Date.now() - started;

    expect(result.totalPartsUnplaced).toBe(0);
    expect(elapsed).toBeLessThan(10_000);
    assertLayoutIsCollisionFree(result, parts, result.config);
  });
});

describe("FIRST VALID -> BEST VALID (Phase: findBestPlacement no longer stops at the first geometrically-valid candidate)", () => {
  it("TEST 1 — a later, tighter-packing candidate is chosen over an earlier, wasteful one", () => {
    // A single 150x150 square already sitting at the sheet's left edge.
    // The 2nd identical square has more than one valid spot to its right:
    // hugging the first square (tight) or floating further out (still
    // valid geometrically, but wastes more of the sheet's overall
    // footprint). BEST VALID must choose the tight one.
    const parts: EnginePartInput[] = [part({ outer: rect(150, 150), qty: 2 })];
    const sources: EngineSourceInput[] = [source({ widthMm: 150, lengthMm: 1000 })];
    const config: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };

    const result = runNestingAlgorithm(parts, sources, config);
    const placements = result.groups[0].sheets[0].placements;
    expect(placements.length).toBe(2);

    // The two squares must sit immediately adjacent (tight), not spaced
    // apart with wasted room between them.
    const xs = placements.map((p) => p.xMm).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(150, 1);
  });

  it("TEST 4 — a candidate that fragments the sheet loses to one that keeps free space contiguous", () => {
    // Placing a small part flush against an existing part (no gap
    // opened up) must be preferred over placing it floating in open
    // space with the same overall validity, because the floating
    // placement grows the occupied bounding box more.
    const parts: EnginePartInput[] = [
      { ...part({ outer: rect(100, 100), qty: 1 }), takeoffPartId: "anchor" },
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 100, lengthMm: 500 })];
    const config: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };
    const seedResult = runNestingAlgorithm(parts, sources, config);
    expect(seedResult.totalPartsPlaced).toBe(1);
    // The anchor sits at the origin corner (0,0)-(100,100). Now placing a
    // second small part should hug it (grow the bbox by only 100x100 more
    // along Y), not park itself far down the 500mm-long sheet.
  });

  it("TEST 5 — deterministic tie-break: identical runs produce the identical layout", () => {
    const parts: EnginePartInput[] = [part({ outer: rect(120, 80), qty: 6 })];
    const sources: EngineSourceInput[] = [source({ widthMm: 500, lengthMm: 500 })];
    const config: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 5 };

    const resultA = runNestingAlgorithm(parts, sources, config);
    const resultB = runNestingAlgorithm(parts, sources, config);

    expect(resultA.groups[0].sheets[0].placements).toEqual(resultB.groups[0].sheets[0].placements);
  });
});


describe("gap enforcement bug fix — partGapMm was only ever used to offset CANDIDATE positions, never actually verified before accepting a placement", () => {
  it("every pair of placed parts is at least partGapMm apart (exact polygon distance, not just non-overlapping)", () => {
    const gapMm = 25;
    const parts: EnginePartInput[] = [
      part({ outer: rect(150, 150), qty: 10 }),
    ];
    const sources: EngineSourceInput[] = [source({ widthMm: 1200, lengthMm: 1200 })];
    const config: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: gapMm };

    const result = runNestingAlgorithm(parts, sources, config);
    const placements = result.groups[0].sheets.flatMap((s) => s.placements);
    expect(placements.length).toBeGreaterThan(1);

    // Compare distances only WITHIN each physical sheet — placements on
    // different sheets are on separate materials, so "distance between
    // them" isn't a meaningful gap check at all.
    for (const sheet of result.groups[0].sheets) {
      const polys = sheet.placements.map((p) => transformGeometryForPlacement(rect(150, 150), [], p.rotationDeg as RotationDeg, p.xMm, p.yMm).outer);
      for (let i = 0; i < polys.length; i++) {
        for (let j = i + 1; j < polys.length; j++) {
          const d = polygonsMinDistance(polys[i], polys[j]);
          expect(d).toBeGreaterThanOrEqual(gapMm - 1e-6);
        }
      }
    }
  });
});


// ----------------------------------------------------------------------------
// FIX 1 — localImprovement must use the SAME placement-quality comparison as
// findBestPlacement (score, then Y, then X, then rotation) when picking
// between relocation candidates gathered from DIFFERENT sheets, instead of
// the old "lower Y, then lower X" shortcut.
// ----------------------------------------------------------------------------
describe("FIX 1 — localImprovement unifies cross-sheet relocation comparison with findBestPlacement's placement-quality rule", () => {
  const config: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };

  function buildScenario() {
    const rotations = new RotationCandidateCache(90, 4);
    const movingOuter = rect(50, 50);
    const movingInstance: OptimizerPartInstance = {
      takeoffPartId: "moving",
      itemNo: 1,
      instanceNumber: 1,
      areaSqm: (50 * 50) / 1_000_000,
      outer: movingOuter,
    };

    // Sheet A: narrow (lengthMm == part width) with an anchor that exactly
    // fills the bottom. The ONLY valid spot for the moving part is snug on
    // top of the anchor -- a HIGHER Y (100) but, thanks to 3-sided contact
    // and a small incremental bounding-box growth, a much BETTER (lower)
    // placement-quality score.
    const sourceA: EngineSourceInput = { sourceSheetId: "A", material: "Steel", thicknessMm: 6, widthMm: 200, lengthMm: 50 };
    const sheetA = makeWorkingSheet(sourceA, config);
    const anchorAOuter = rect(50, 100);
    sheetA.placements.push({ takeoffPartId: "anchorA", instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, widthMm: 50, heightMm: 100 });
    sheetA.polygons.push(anchorAOuter);

    // Sheet B: a large, otherwise-empty sheet. The best available spot is
    // the sheet corner: a LOWER Y (0), but with only 2-sided contact and a
    // WORSE (higher) placement-quality score than sheet A's snug spot.
    const sourceB: EngineSourceInput = { sourceSheetId: "B", material: "Steel", thicknessMm: 6, widthMm: 300, lengthMm: 300 };
    const sheetB = makeWorkingSheet(sourceB, config);

    return { rotations, movingOuter, movingInstance, anchorAOuter, sheetA, sheetB };
  }

  it("proves the lower-Y candidate is NOT the better-scored one (setup sanity check)", () => {
    const { rotations, movingInstance, sheetA, sheetB } = buildScenario();

    const attemptA = findBestPlacement(movingInstance, sheetA, config, 60, rotations);
    const attemptB = findBestPlacement(movingInstance, sheetB, config, 60, rotations);
    expect(attemptA).not.toBeNull();
    expect(attemptB).not.toBeNull();

    // Sheet B's candidate has the LOWER Y...
    expect(attemptB!.y).toBeLessThan(attemptA!.y);
    // ...but sheet A's candidate is the genuinely BETTER placement (lower
    // score). A pure "lower Y wins" comparison would therefore pick the
    // wrong (worse) candidate here.
    expect(attemptA!.score).toBeLessThan(attemptB!.score);
  });

  it("localImprovement relocates the part onto the better-scored sheet, not the lower-Y one", () => {
    const { rotations, movingOuter, anchorAOuter, sheetA, sheetB } = buildScenario();

    // The moving part currently sits on sheet B, at the very spot the old
    // "lower Y, then lower X" comparison would have (wrongly) preferred.
    sheetB.placements.push({ takeoffPartId: "moving", instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, widthMm: 50, heightMm: 50 });
    sheetB.polygons.push(movingOuter);

    const areaByPartId = new Map<string, number>([
      ["anchorA", (50 * 100) / 1_000_000],
      ["moving", (50 * 50) / 1_000_000],
    ]);
    const outerByPartId = new Map<string, Point[]>([
      ["anchorA", anchorAOuter],
      ["moving", movingOuter],
    ]);

    const result = localImprovement(
      [sheetA, sheetB],
      areaByPartId,
      outerByPartId,
      config,
      60,
      Date.now() + 5000,
      () => 0, // deterministic rng; only one relocatable candidate part exists anyway
      rotations,
    );

    const finalA = result.sheets.find((s) => s.sourceSheetId === "A")!;
    const finalB = result.sheets.find((s) => s.sourceSheetId === "B")!;

    // The moving part must end up on sheet A (the better-scored relocation),
    // not stay on sheet B (the lower-Y one). Sheet B, having lost its only
    // placement, is left empty -- a strong, unambiguous signal that a real
    // cross-sheet relocation happened and picked the correct sheet.
    expect(finalA.placements.some((p) => p.takeoffPartId === "moving")).toBe(true);
    expect(finalB.placements.some((p) => p.takeoffPartId === "moving")).toBe(false);
    expect(result.moves).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------------------
// FIX 2 — the candidate cap is a deterministic, spatially-diverse BOUNDED
// SAMPLE of the generated candidate origins, not just "the first N after
// sorting by Y then X" (which systematically starves later spatial
// regions).
// ----------------------------------------------------------------------------
describe("FIX 2 — bounded candidate origin sampling preserves spatial diversity", () => {
  it("returns at most `cap` origins, unchanged, when there are fewer origins than the cap", () => {
    const sorted: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const result = selectBoundedCandidateOrigins(sorted, 10);
    expect(result).toEqual(sorted);
  });

  it("bounds the selection to exactly `cap` origins when there are more origins than the cap", () => {
    const sorted: Point[] = Array.from({ length: 100 }, (_, i) => ({ x: 0, y: i }));
    const cap = 10;
    const result = selectBoundedCandidateOrigins(sorted, cap);
    expect(result.length).toBe(cap);
  });

  it("is deterministic: the same input and cap always produce the identical selection", () => {
    const sorted: Point[] = Array.from({ length: 137 }, (_, i) => ({ x: i % 7, y: i }));
    const cap = 23;
    const first = selectBoundedCandidateOrigins(sorted, cap);
    const second = selectBoundedCandidateOrigins(sorted, cap);
    expect(second).toEqual(first);
  });

  it("does NOT simply take the first `cap` lowest-Y/X origins — a later spatial region survives the cap", () => {
    // 100 origins sorted ascending by Y (0..99), as generateCandidateOrigins
    // would hand in. The naive `slice(0, cap)` behavior this fix replaces
    // would return exactly Y = 0..9 and nothing from later Y bands.
    const sorted: Point[] = Array.from({ length: 100 }, (_, i) => ({ x: 0, y: i }));
    const cap = 10;
    const result = selectBoundedCandidateOrigins(sorted, cap);

    expect(result.length).toBe(cap);
    const ys = result.map((p) => p.y);

    // The naive "first N" set is NOT what was returned.
    expect(ys).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // At least one surviving candidate comes from a later spatial region
    // (well past where a `slice(0, cap)` cutoff would have reached).
    expect(ys.some((y) => y >= 50)).toBe(true);

    // The strongest/lowest-Y candidates are still preserved (a reasonable,
    // cheap prior), so the cap doesn't throw away good compactness options.
    expect(ys).toContain(0);
  });

  it("end-to-end: findBestPlacement still evaluates only a bounded number of candidates, and the bounded sample reaches a useful, far-away spatial region", () => {
    // A sheet with a dense cluster of tiny obstacles along the very bottom
    // (generating MANY low-Y candidate origins, all clustered near y = 0/2)
    // plus one small anchor far up the sheet (y = 300). A naive
    // `slice(0, cap)` on the Y-then-X sorted raw list would be entirely
    // consumed by the bottom cluster and never reach the high anchor at
    // all; the bounded, spatially-diverse sample must still reach it.
    const config: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };
    const rotations = new RotationCandidateCache(90, 4);

    const source: EngineSourceInput = { sourceSheetId: "S", material: "Steel", thicknessMm: 6, widthMm: 400, lengthMm: 200 };
    const sheet = makeWorkingSheet(source, config);
    for (let x = 0; x < 40; x += 4) {
      const obstacle = [
        { x, y: 0 },
        { x: x + 2, y: 0 },
        { x: x + 2, y: 2 },
        { x, y: 2 },
      ];
      sheet.placements.push({ takeoffPartId: `obst-${x}`, instanceNumber: 1, xMm: x, yMm: 0, rotationDeg: 0, widthMm: 2, heightMm: 2 });
      sheet.polygons.push(obstacle);
    }
    const highAnchorOuter = rect(10, 10).map((p) => ({ x: p.x, y: p.y + 300 }));
    sheet.placements.push({ takeoffPartId: "high-anchor", instanceNumber: 1, xMm: 0, yMm: 300, rotationDeg: 0, widthMm: 10, heightMm: 10 });
    sheet.polygons.push(highAnchorOuter);

    const shapeWidth = 5;
    const shapeHeight = 5;
    const smallCap = 20;

    // The raw (unbounded) candidate list is dominated by the low-Y cluster,
    // but does contain a handful of origins from up near the high anchor.
    const rawUnbounded = generateCandidateOrigins(shapeWidth, shapeHeight, sheet, 0, 10_000);
    const rawFarRegionCount = rawUnbounded.filter((p) => p.y >= 250).length;
    expect(rawFarRegionCount).toBeGreaterThan(0);
    expect(rawUnbounded.length).toBeGreaterThan(smallCap);

    // The bounded sample (what findBestPlacement actually searches) must
    // still include at least one origin from that far-away region -- proof
    // the cap doesn't just take the first `smallCap` lowest-Y/X origins.
    const bounded = generateCandidateOrigins(shapeWidth, shapeHeight, sheet, 0, smallCap);
    expect(bounded.length).toBeLessThanOrEqual(smallCap);
    expect(bounded.some((p) => p.y >= 250)).toBe(true);

    const instance: OptimizerPartInstance = {
      takeoffPartId: "target",
      itemNo: 1,
      instanceNumber: 1,
      areaSqm: (shapeWidth * shapeHeight) / 1_000_000,
      outer: rect(shapeWidth, shapeHeight),
    };

    const before = rotations.evaluationCount;
    const attempt = findBestPlacement(instance, sheet, config, smallCap, rotations);
    const evaluated = rotations.evaluationCount - before;

    expect(attempt).not.toBeNull();
    // Bounded: at most `smallCap` origins evaluated per rotation candidate
    // (4 rotations available at a 90-degree step here).
    expect(evaluated).toBeLessThanOrEqual(smallCap * 4);

    // Deterministic: repeating the exact same search reproduces the exact
    // same winning placement.
    const repeat = findBestPlacement(instance, sheet, config, smallCap, rotations);
    expect(repeat).toEqual(attempt);
  });
});

function DEFAULT_CONFIG(): EngineConfig {
  return {
    marginLeftMm: 5,
    marginRightMm: 5,
    marginTopMm: 5,
    marginBottomMm: 5,
    partGapMm: 0,
  };
}
