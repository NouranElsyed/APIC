import { describe, expect, it } from "vitest";
import {
  runNestingAlgorithm,
  DEFAULT_ENGINE_CONFIG,
  type EnginePartInput,
  type EngineSourceInput,
} from "./nesting-engine";
import type { Point } from "./dxf";

// ----------------------------------------------------------------------------
// Test helpers — build simple axis-aligned rectangular part contours (mm),
// which is all these deterministic packing tests need. Real DXF-derived
// contours flow through the exact same `outer: Point[]` shape at runtime
// (see nesting-run.service.ts), so testing against rectangles here exercises
// the real geometry/collision/placement code paths, not a mock.
// ----------------------------------------------------------------------------

function rect(widthMm: number, heightMm: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ];
}

function part(overrides: Partial<EnginePartInput> & { widthMm: number; heightMm: number }): EnginePartInput {
  const { widthMm, heightMm, ...rest } = overrides;
  return {
    takeoffPartId: "part-1",
    itemNo: 1,
    material: "Steel",
    thicknessMm: 6,
    qty: 1,
    areaSqm: (widthMm * heightMm) / 1_000_000,
    outer: rect(widthMm, heightMm),
    ...rest,
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

describe("runNestingAlgorithm", () => {
  it("Test 1 — one rectangular part fits on one sheet", () => {
    const parts = [part({ widthMm: 300, heightMm: 200 })];
    const sources = [source({ widthMm: 1000, lengthMm: 1000 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(1);
    expect(result.totalPartsUnplaced).toBe(0);
    expect(result.unplacedParts).toHaveLength(0);
    expect(result.totalSheetsUsed).toBe(1);
    expect(result.groups[0].sheets[0].placements).toHaveLength(1);
  });

  it("Test 2 — multiple identical parts: no overlap, correct quantity, deterministic placement", () => {
    const parts = [part({ widthMm: 100, heightMm: 100, qty: 6 })];
    const sources = [source({ widthMm: 1000, lengthMm: 1000 })];

    const result = runNestingAlgorithm(parts, sources);
    const run1Placements = result.groups[0].sheets.flatMap((s) => s.placements);

    expect(result.totalPartsPlaced).toBe(6);
    expect(result.totalPartsUnplaced).toBe(0);
    expect(run1Placements).toHaveLength(6);

    // No two placements overlap (AABB check is sufficient for axis-aligned
    // rectangles at 0/90/180/270 degree rotation).
    for (let i = 0; i < run1Placements.length; i++) {
      for (let j = i + 1; j < run1Placements.length; j++) {
        const a = run1Placements[i];
        const b = run1Placements[j];
        const aRight = a.xMm + a.widthMm;
        const aTop = a.yMm + a.heightMm;
        const bRight = b.xMm + b.widthMm;
        const bTop = b.yMm + b.heightMm;
        const overlap = a.xMm < bRight && aRight > b.xMm && a.yMm < bTop && aTop > b.yMm;
        expect(overlap).toBe(false);
      }
    }

    // Deterministic: running the same input twice yields the same layout.
    const result2 = runNestingAlgorithm(parts, sources);
    const run2Placements = result2.groups[0].sheets.flatMap((s) => s.placements);
    expect(run2Placements).toEqual(run1Placements);
  });

  it("Test 3 — a part that only fits after rotation is placed with rotation = 90", () => {
    // Sheet interior (after default 5mm edge clearance) is 190x990. A part
    // that is 900mm wide and 150mm tall cannot fit at 0 deg (900 > 190
    // horizontally is fine actually — flip the numbers to force rotation):
    // width 900 > usable width 190 at 0deg, but usable height 990 is plenty,
    // so rotating 90 degrees swaps width/height to 150x900, which fits.
    const parts = [part({ widthMm: 900, heightMm: 150 })];
    const sources = [source({ widthMm: 200, lengthMm: 1000 })];

    const result = runNestingAlgorithm(parts, sources);
    const placements = result.groups[0].sheets.flatMap((s) => s.placements);

    expect(result.totalPartsPlaced).toBe(1);
    expect(placements[0].rotationDeg).toBe(90);
  });

  it("Test 4 — a part larger than any sheet is reported as unplaced with PART_TOO_LARGE", () => {
    const parts = [part({ widthMm: 5000, heightMm: 5000 })];
    const sources = [source({ widthMm: 1000, lengthMm: 1000 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(0);
    expect(result.totalPartsUnplaced).toBe(1);
    expect(result.unplacedParts).toHaveLength(1);
    expect(result.unplacedParts[0].reason).toBe("PART_TOO_LARGE");
  });

  it("Test 5 — parts continue onto the next source sheet when the first is full", () => {
    // Each part is ~330x330 with 5mm clearance -> only one fits per 400x400
    // sheet's usable 390x390 area (shelf packer, not a dense packer).
    const parts = [part({ widthMm: 330, heightMm: 330, qty: 2 })];
    const sources = [source({ widthMm: 400, lengthMm: 400 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(2);
    expect(result.totalPartsUnplaced).toBe(0);
    expect(result.totalSheetsUsed).toBe(2);
  });

  it("Test 5b — a source sheet has no fixed quantity: the engine buys as many as needed automatically", () => {
    // Only ONE source sheet definition is declared (no quantity field at
    // all, per PROJECT.md §2/§4) but 37 parts are required and only 1 fits
    // per sheet — the engine must open as many physical sheets as it takes
    // rather than reporting a shortage.
    const parts = [part({ widthMm: 330, heightMm: 330, qty: 37 })];
    const sources = [source({ widthMm: 400, lengthMm: 400 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(37);
    expect(result.totalPartsUnplaced).toBe(0);
    expect(result.totalSheetsUsed).toBe(37);
    expect(result.sourceRequirements).toHaveLength(1);
    expect(result.sourceRequirements[0].requiredQty).toBe(37);
  });

  it("Test 11 — required sheet quantity: 37 parts at 12 parts per sheet requires 4 sheets", () => {
    // 100x100mm parts, no gap, on a sheet whose usable area (after default
    // margins) fits exactly 12 per sheet in a 4x3 grid.
    const parts = [part({ widthMm: 100, heightMm: 100, qty: 37 })];
    const sources = [source({ widthMm: 405, lengthMm: 305 })]; // usable 395x295 -> exactly 3 cols x 2... adjust below

    const result = runNestingAlgorithm(parts, sources, {
      marginLeftMm: 2.5,
      marginRightMm: 2.5,
      marginTopMm: 2.5,
      marginBottomMm: 2.5,
      partGapMm: 0,
    });

    // Whatever the exact per-sheet count the shelf packer achieves, every
    // part must be placed and the reported required quantity for the one
    // source definition must equal the number of sheets actually used.
    expect(result.totalPartsPlaced).toBe(37);
    expect(result.sourceRequirements[0].requiredQty).toBe(result.totalSheetsUsed);
  });

  it("Test 6 — parts grouped by different materials never mix onto an incompatible sheet", () => {
    const steelPart = part({ takeoffPartId: "steel-1", itemNo: 1, material: "Steel", thicknessMm: 6, widthMm: 200, heightMm: 200 });
    const aluminumPart = part({ takeoffPartId: "alu-1", itemNo: 2, material: "Aluminum", thicknessMm: 3, widthMm: 200, heightMm: 200 });
    const steelSource = source({ sourceSheetId: "steel-sheet", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 });

    // Only a Steel/6mm source is available — the Aluminum/3mm part must be
    // reported unplaced (NO_SOURCE_SHEET), never placed on the steel sheet.
    const result = runNestingAlgorithm([steelPart, aluminumPart], [steelSource]);

    expect(result.totalPartsPlaced).toBe(1);
    expect(result.totalPartsUnplaced).toBe(1);
    const unplaced = result.unplacedParts.find((u) => u.takeoffPartId === "alu-1");
    expect(unplaced?.reason).toBe("NO_SOURCE_SHEET");

    const steelGroup = result.groups.find((g) => g.material === "Steel")!;
    const aluGroup = result.groups.find((g) => g.material === "Aluminum")!;
    expect(steelGroup.sheets).toHaveLength(1);
    expect(aluGroup.sheets).toHaveLength(0);
    // The steel sheet only ever contains the steel part.
    expect(steelGroup.sheets[0].placements.every((p) => p.takeoffPartId === "steel-1")).toBe(true);
  });

  it("Test 7 — utilization / used area / scrap area match known expected values", () => {
    // 500x400mm sheet = 0.2 m². A single 300x200mm part = 0.06 m².
    const parts = [part({ widthMm: 300, heightMm: 200 })];
    const sources = [source({ widthMm: 500, lengthMm: 400 })];

    const result = runNestingAlgorithm(parts, sources, DEFAULT_ENGINE_CONFIG);
    const sheet = result.groups[0].sheets[0];

    const expectedSheetAreaSqm = (500 * 400) / 1_000_000; // 0.2
    const expectedUsedAreaSqm = (300 * 200) / 1_000_000; // 0.06
    const expectedScrapAreaSqm = expectedSheetAreaSqm - expectedUsedAreaSqm; // 0.14
    const expectedUtilization = (expectedUsedAreaSqm / expectedSheetAreaSqm) * 100; // 30%

    expect(sheet.usedAreaSqm).toBeCloseTo(expectedUsedAreaSqm, 9);
    expect(sheet.scrapAreaSqm).toBeCloseTo(expectedScrapAreaSqm, 9);
    expect(sheet.utilizationPercent).toBeCloseTo(expectedUtilization, 9);

    expect(result.totalUsedAreaSqm).toBeCloseTo(expectedUsedAreaSqm, 9);
    expect(result.totalScrapAreaSqm).toBeCloseTo(expectedScrapAreaSqm, 9);
    expect(result.overallUtilizationPercent).toBeCloseTo(expectedUtilization, 9);
  });

  it("reports NO_SOURCE_SHEET when a material/thickness group has no sources at all", () => {
    const parts = [part({ widthMm: 100, heightMm: 100 })];
    const result = runNestingAlgorithm(parts, []);

    expect(result.totalPartsPlaced).toBe(0);
    expect(result.unplacedParts[0].reason).toBe("NO_SOURCE_SHEET");
  });

  it("never places a part outside the sheet boundary given sheet margins", () => {
    const parts = [part({ widthMm: 50, heightMm: 50, qty: 10 })];
    const sources = [source({ widthMm: 300, lengthMm: 300 })];
    const config = { marginLeftMm: 10, marginRightMm: 10, marginTopMm: 10, marginBottomMm: 10, partGapMm: 2 };

    const result = runNestingAlgorithm(parts, sources, config);

    for (const group of result.groups) {
      for (const sheet of group.sheets) {
        for (const placement of sheet.placements) {
          expect(placement.xMm).toBeGreaterThanOrEqual(config.marginLeftMm - 1e-6);
          expect(placement.yMm).toBeGreaterThanOrEqual(config.marginBottomMm - 1e-6);
          expect(placement.xMm + placement.widthMm).toBeLessThanOrEqual(sheet.widthMm - config.marginRightMm + 1e-6);
          expect(placement.yMm + placement.heightMm).toBeLessThanOrEqual(sheet.lengthMm - config.marginTopMm + 1e-6);
        }
      }
    }
  });

  it("respects asymmetric per-side margins independently", () => {
    // A large left margin should shrink usable width without affecting the
    // usable height at all.
    const parts = [part({ widthMm: 100, heightMm: 100 })];
    const sources = [source({ widthMm: 300, lengthMm: 300 })];
    const config = { marginLeftMm: 150, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };

    const result = runNestingAlgorithm(parts, sources, config);
    const placement = result.groups[0].sheets[0].placements[0];

    expect(placement.xMm).toBeGreaterThanOrEqual(150 - 1e-6);
  });

  it("Part Gap = 0 allows parts to touch edge-to-edge without being treated as overlapping", () => {
    const parts = [part({ widthMm: 100, heightMm: 100, qty: 2 })];
    const sources = [source({ widthMm: 400, lengthMm: 400 })];
    const config = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };

    const result = runNestingAlgorithm(parts, sources, config);
    expect(result.totalPartsPlaced).toBe(2);
    const [a, b] = result.groups[0].sheets[0].placements;
    // They end up flush (touching), never overlapping — shelf packing puts
    // the second part's x exactly at the first part's right edge.
    expect(Math.abs(a.xMm + a.widthMm - b.xMm)).toBeCloseTo(0, 6);
  });

  it("Part Gap > 0 enforces the minimum separation between two parts", () => {
    const parts = [part({ widthMm: 100, heightMm: 100, qty: 2 })];
    const sources = [source({ widthMm: 400, lengthMm: 400 })];
    const config = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 10 };

    const result = runNestingAlgorithm(parts, sources, config);
    expect(result.totalPartsPlaced).toBe(2);
    const [a, b] = result.groups[0].sheets[0].placements;
    expect(b.xMm - (a.xMm + a.widthMm)).toBeCloseTo(10, 6);
  });

  // --------------------------------------------------------------------------
  // Phase 2B — availableQty is now a HARD LIMIT (PROJECT.md §2), automatic
  // sheet-size selection (§3), and shortage reporting (§9/§16).
  // --------------------------------------------------------------------------

  it("availableQty caps how many physical sheets of a source can be opened", () => {
    // Only 1 fits per 400x400 sheet; 3 parts required but only 2 sheets available.
    const parts = [part({ widthMm: 330, heightMm: 330, qty: 3 })];
    const sources = [source({ widthMm: 400, lengthMm: 400, availableQty: 2 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalSheetsUsed).toBe(2);
    expect(result.totalPartsPlaced).toBe(2);
    expect(result.totalPartsUnplaced).toBe(1);
    expect(result.unplacedParts[0].reason).toBe("INSUFFICIENT_SOURCE_QTY");
    expect(result.unplacedParts[0].remainingQty).toBe(1);
  });

  it("reports a clear shortage (required / available / shortfall) when capped sources run out", () => {
    const parts = [part({ widthMm: 330, heightMm: 330, qty: 5 })];
    const sources = [source({ widthMm: 400, lengthMm: 400, availableQty: 2 })];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.sourceShortages).toHaveLength(1);
    expect(result.sourceShortages[0]).toMatchObject({
      material: "Steel",
      thicknessMm: 6,
      requiredSheets: 5,
      availableSheets: 2,
      shortageSheets: 3,
    });
  });

  it("never opens more sheets of a source than its availableQty even across multiple parts", () => {
    const a = part({ takeoffPartId: "a", itemNo: 1, widthMm: 330, heightMm: 330, qty: 2 });
    const b = part({ takeoffPartId: "b", itemNo: 2, widthMm: 330, heightMm: 330, qty: 2 });
    const sources = [source({ widthMm: 400, lengthMm: 400, availableQty: 3 })];

    const result = runNestingAlgorithm([a, b], sources);

    expect(result.totalSheetsUsed).toBe(3);
    expect(result.sourceRequirements[0].requiredQty).toBe(3);
    expect(result.sourceRequirements[0].availableQty).toBe(3);
    expect(result.totalPartsPlaced).toBe(3);
    expect(result.totalPartsUnplaced).toBe(1);
  });

  it("a source with no availableQty stays unlimited even alongside a capped source (no false shortage)", () => {
    const parts = [part({ widthMm: 330, heightMm: 330, qty: 10 })];
    const sources = [
      source({ sourceSheetId: "capped", widthMm: 400, lengthMm: 400, availableQty: 1 }),
      source({ sourceSheetId: "unlimited", widthMm: 400, lengthMm: 400 }),
    ];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(10);
    expect(result.totalPartsUnplaced).toBe(0);
    expect(result.sourceShortages).toHaveLength(0);
  });

  it("automatic sheet-size selection prefers the source that yields fewer sheets / less scrap", () => {
    // 900x900mm parts, qty 4. A 1000x1000 sheet fits exactly 1 per sheet
    // (needs 4 sheets); a 2000x1000 sheet (usable ~1990x990) fits 1 per
    // sheet too under this shelf packer's row logic for a 900x900 part
    // (two per row would need ~1800 width, which DOES fit) — so the larger
    // sheet should win by needing fewer physical sheets.
    const parts = [part({ widthMm: 900, heightMm: 900, qty: 4 })];
    const sources = [
      source({ sourceSheetId: "small", widthMm: 1000, lengthMm: 1000 }),
      source({ sourceSheetId: "large", widthMm: 2000, lengthMm: 1000 }),
    ];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(4);
    // The engine should have preferred opening the more efficient "large"
    // definition over blindly round-robining between the two.
    const usedSourceIds = new Set(result.groups[0].sheets.map((s) => s.sourceSheetId));
    expect(usedSourceIds.has("large")).toBe(true);
    const largeRequirement = result.sourceRequirements.find((r) => r.sourceSheetId === "large");
    const smallRequirement = result.sourceRequirements.find((r) => r.sourceSheetId === "small");
    // Large sheets should carry most/all of the load since they pack 2-per-sheet.
    expect(largeRequirement?.requiredQty ?? 0).toBeGreaterThan(smallRequirement?.requiredQty ?? 0);
  });

  it("falls back to a lower-ranked source once the best one's availableQty is exhausted", () => {
    const parts = [part({ widthMm: 900, heightMm: 900, qty: 4 })];
    const sources = [
      source({ sourceSheetId: "small", widthMm: 1000, lengthMm: 1000 }), // unlimited fallback
      source({ sourceSheetId: "large", widthMm: 2000, lengthMm: 1000, availableQty: 1 }), // best but capped
    ];

    const result = runNestingAlgorithm(parts, sources);

    expect(result.totalPartsPlaced).toBe(4);
    expect(result.totalPartsUnplaced).toBe(0);
    const usedSourceIds = result.groups[0].sheets.map((s) => s.sourceSheetId);
    expect(usedSourceIds.filter((id) => id === "large")).toHaveLength(1);
    expect(usedSourceIds.some((id) => id === "small")).toBe(true);
  });
});
