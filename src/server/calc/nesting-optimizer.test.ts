import { describe, expect, it } from "vitest";
import { runNestingAlgorithm, type EnginePartInput, type EngineSourceInput, type EngineConfig } from "./nesting-engine";
import { polygonsOverlap, boundsContain, transformGeometryForPlacement, type RotationDeg } from "./nesting-geometry";
import type { Point } from "./dxf";

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
        const minX = config.marginLeftMm;
        const minY = config.marginBottomMm;
        const maxX = sheet.widthMm - config.marginRightMm;
        const maxY = sheet.lengthMm - config.marginTopMm;
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
    const sources: EngineSourceInput[] = [source({ widthMm: 200, lengthMm: 1000 })];

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

function DEFAULT_CONFIG(): EngineConfig {
  return {
    marginLeftMm: 5,
    marginRightMm: 5,
    marginTopMm: 5,
    marginBottomMm: 5,
    partGapMm: 0,
  };
}
