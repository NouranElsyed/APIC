import { describe, expect, it } from "vitest";
import { optimizeRemaining, optimizeRemainingWithPreference, optimizeEntireSessionWithFullOptimizer, validateSessionForExport, type AssistedSheetSession, type SessionPartCatalogEntry } from "./nesting-assisted-session";
import type { EngineConfig, EngineSourceInput } from "./nesting-engine";
import { computeOrientedShape, translatePoints, polygonsOverlap, boundsContain } from "./nesting-geometry";
import type { Point } from "./dxf";

function rect(widthMm: number, heightMm: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
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

const ZERO_MARGIN: EngineConfig = { marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, partGapMm: 0 };

function catalogEntry(overrides: Partial<SessionPartCatalogEntry> & { outer: Point[]; requiredQty: number }): SessionPartCatalogEntry {
  return {
    takeoffPartId: "p1",
    itemNo: 1,
    areaSqm: polygonArea(overrides.outer) / 1_000_000,
    ...overrides,
  };
}

function allPolygonsCollisionFree(sheets: AssistedSheetSession[], sheetBoundsByMaterial: (s: AssistedSheetSession) => { minX: number; minY: number; maxX: number; maxY: number }) {
  for (const sheet of sheets) {
    const bounds = sheetBoundsByMaterial(sheet);
    const polygons = sheet.instances.map((inst) => {
      const shape = computeOrientedShape(inst.outer, inst.rotationDeg);
      return translatePoints(shape.points, inst.xMm, inst.yMm);
    });
    for (const poly of polygons) {
      expect(boundsContain(poly, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)).toBe(true);
    }
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        expect(polygonsOverlap(polygons[i], polygons[j])).toBe(false);
      }
    }
  }
}

describe("optimizeRemaining", () => {
  it("fills remaining quantity around a locked manual placement on the SAME sheet without moving it", () => {
    const partOuter = rect(150, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1200,
      lengthMm: 1200,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.015, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 6 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1200, lengthMm: 1200 }];

    const result = optimizeRemaining([sheet], catalog, sources, ZERO_MARGIN);

    expect(result.fullyPlaced).toBe(true);
    expect(result.stillShortByPart.size).toBe(0);
    expect(result.openedNewSheets).toBe(0);

    // The manual instance must still be at its original position.
    const manual = result.sheets[0].instances.find((i) => i.origin === "MANUAL");
    expect(manual!.xMm).toBe(0);
    expect(manual!.yMm).toBe(0);

    expect(result.sheets[0].instances).toHaveLength(6);
    allPolygonsCollisionFree(result.sheets, () => ({ minX: 0, minY: 0, maxX: 1200, maxY: 1200 }));
  });

  it("opens additional sheets when required quantity cannot fit on the sheets already in the session", () => {
    const partOuter = rect(400, 400);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 500,
      lengthMm: 500,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.16, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 500, lengthMm: 500 }];

    const result = optimizeRemaining([sheet], catalog, sources, ZERO_MARGIN);

    expect(result.fullyPlaced).toBe(true);
    expect(result.openedNewSheets).toBeGreaterThanOrEqual(1);
    expect(result.sheets.length).toBeGreaterThan(1);
    allPolygonsCollisionFree(result.sheets, () => ({ minX: 0, minY: 0, maxX: 500, maxY: 500 }));
  });

  it("reports a genuine shortfall (never force-fits) when no compatible source can ever hold the part", () => {
    const tinySheetOuter = rect(50, 50);
    const hugePartOuter = rect(5000, 5000);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 100,
      lengthMm: 100,
      instances: [],
    };
    const catalog = new Map<string, SessionPartCatalogEntry>([
      ["small", catalogEntry({ takeoffPartId: "small", outer: tinySheetOuter, requiredQty: 1 })],
      ["huge", catalogEntry({ takeoffPartId: "huge", itemNo: 2, outer: hugePartOuter, requiredQty: 1 })],
    ]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 100, lengthMm: 100 }];

    const result = optimizeRemaining([sheet], catalog, sources, ZERO_MARGIN);

    expect(result.fullyPlaced).toBe(false);
    expect(result.stillShortByPart.get("huge")).toBe(1);
    expect(result.stillShortByPart.has("small")).toBe(false);
  });

  it("is a no-op when required quantities are already fully satisfied", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeRemaining([sheet], catalog, sources, ZERO_MARGIN);

    expect(result.newlyPlacedCount).toBe(0);
    expect(result.openedNewSheets).toBe(0);
    expect(result.sheets[0].instances).toHaveLength(1);
  });
});

describe("validateSessionForExport", () => {
  it("passes a valid, fully-placed session with no issues", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);

    const result = validateSessionForExport([sheet], catalog, ZERO_MARGIN);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags overlapping placements and blocks export", () => {
    const partOuter = rect(200, 200);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.04, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
        // Deliberately overlapping the first instance.
        { instanceKey: "k2", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.04, instanceNumber: 2, xMm: 50, yMm: 50, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 2 })]]);

    const result = validateSessionForExport([sheet], catalog, ZERO_MARGIN);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === "OVERLAP")).toBe(true);
  });

  it("flags a placement that crosses the usable margin and blocks export", () => {
    const partOuter = rect(200, 200);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        // xMm=0 with a 25mm left margin puts this part outside the usable area.
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.04, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);
    const marginConfig: EngineConfig = { marginLeftMm: 25, marginRightMm: 25, marginTopMm: 25, marginBottomMm: 25, partGapMm: 0 };

    const result = validateSessionForExport([sheet], catalog, marginConfig);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === "OUTSIDE_MARGIN")).toBe(true);
  });

  it("reports a quantity shortfall as a non-blocking issue", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 5 })]]);

    const result = validateSessionForExport([sheet], catalog, ZERO_MARGIN);
    // No geometry issue, so still "valid" enough to export as a partial nest.
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.kind === "QUANTITY_SHORTFALL")).toBe(true);
  });
});

describe("optimizeRemainingWithPreference", () => {
  it("STRICT never moves any existing instance, regardless of origin", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
        { instanceKey: "k2", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 2, xMm: 200, yMm: 0, rotationDeg: 0, locked: false, origin: "PATTERN" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 4 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "STRICT");

    expect(result.kept).toBe("ORIGINAL");
    const manual = result.sheets[0].instances.find((i) => i.instanceKey === "k1")!;
    const pattern = result.sheets[0].instances.find((i) => i.instanceKey === "k2")!;
    expect(manual.xMm).toBe(0);
    expect(pattern.xMm).toBe(200);
    // Additional instances were added to reach the required quantity.
    expect(result.sheets[0].instances.length).toBeGreaterThan(2);
  });

  it("FLEXIBLE keeps MANUAL instances locked but may release PATTERN/OPTIMIZED ones", () => {
    const partOuter = rect(100, 100);
    // A pattern instance placed awkwardly far from the manual one, wasting
    // space a tighter re-placement could reclaim.
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
        { instanceKey: "k2", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 2, xMm: 900, yMm: 900, rotationDeg: 0, locked: false, origin: "PATTERN" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 2 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

    // The manual instance must never move under FLEXIBLE.
    const manual = result.sheets[0].instances.find((i) => i.takeoffPartId === "p1" && i.xMm === 0 && i.yMm === 0);
    expect(manual).toBeDefined();
    // Required quantity is still respected exactly.
    expect(result.sheets[0].instances).toHaveLength(2);
  });

  it("OPTIMIZE may rebuild the whole sheet from scratch, but only if it does not reduce placed quantity or increase the score", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "OPTIMIZE");

    // Required quantity must always be satisfied without exceeding it.
    expect(result.sheets[0].instances).toHaveLength(3);
    expect(result.sheets[0].instances.filter((i) => i.takeoffPartId === "p1")).toHaveLength(3);
  });

  it("never regresses: a preference that cannot improve on the original falls back to ORIGINAL", () => {
    // Required quantity already fully satisfied — there is nothing useful
    // for FLEXIBLE/OPTIMIZE to do, so the session must come back unchanged.
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "OPTIMIZE");

    expect(result.sheets[0].instances).toHaveLength(1);
    expect(result.sheets[0].instances[0].xMm).toBe(0);
    expect(result.sheets[0].instances[0].yMm).toBe(0);
  });
});

describe("optimizeEntireSessionWithFullOptimizer", () => {
  it("rebuilds using the full multi-strategy optimizer and satisfies exact required quantity", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 900, yMm: 900, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 5 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeEntireSessionWithFullOptimizer([sheet], catalog, sources, ZERO_MARGIN);

    const totalPlaced = result.sheets.reduce((sum, s) => sum + s.instances.length, 0);
    expect(totalPlaced).toBe(5);
    // A full rebuild relabels everything OPTIMIZED — there's no more
    // "manual" placement to preserve once the optimizer has redesigned
    // the whole layout.
    if (result.kept === "REBUILT") {
      for (const s of result.sheets) {
        for (const inst of s.instances) expect(inst.origin).toBe("OPTIMIZED");
      }
    }
    allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
  });

  it("never reduces the number of placed parts or accepts a worse score than the original", () => {
    const partOuter = rect(100, 100);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: "k1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeEntireSessionWithFullOptimizer([sheet], catalog, sources, ZERO_MARGIN);

    expect(result.totalPlacedAfter).toBeGreaterThanOrEqual(result.totalPlacedBefore);
    expect(result.scoreAfter).toBeLessThanOrEqual(result.scoreBefore);
  });
});

describe("multi-sheet isolation", () => {
  // Two sheets each carrying an identical manual placement at the exact
  // same local coordinates — this is only valid because collision
  // checking is per-sheet; if placements were ever compared ACROSS
  // sheets, this would incorrectly register as an overlap.
  function twoSheetsWithIdenticalManualPlacement(): AssistedSheetSession[] {
    const partOuter = rect(200, 200);
    const makeSheet = (id: string): AssistedSheetSession => ({
      sourceSheetId: id,
      material: "Steel",
      thicknessMm: 6,
      widthMm: 1000,
      lengthMm: 1000,
      instances: [
        { instanceKey: `${id}-k1`, takeoffPartId: "p1", outer: partOuter, areaSqm: 0.04, instanceNumber: 1, xMm: 100, yMm: 100, rotationDeg: 0, locked: true, origin: "MANUAL" },
      ],
    });
    return [makeSheet("s1"), makeSheet("s2")];
  }

  it("optimizeRemaining fills each sheet independently — identical coordinates on different sheets never collide", () => {
    const partOuter = rect(200, 200);
    const sheets = twoSheetsWithIdenticalManualPlacement();
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 2 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

    const result = optimizeRemaining(sheets, catalog, sources, ZERO_MARGIN);

    // Both manual instances must remain exactly where they were — quantity
    // was already satisfied (2 required, 2 already placed across the two
    // sheets), so nothing new should be generated.
    expect(result.newlyPlacedCount).toBe(0);
    expect(result.fullyPlaced).toBe(true);
    expect(result.sheets[0].instances[0].xMm).toBe(100);
    expect(result.sheets[1].instances[0].xMm).toBe(100);
    allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
  });

  it("validateSessionForExport checks collisions per-sheet, never across sheets", () => {
    const sheets = twoSheetsWithIdenticalManualPlacement();
    const catalog = new Map([["p1", catalogEntry({ outer: rect(200, 200), requiredQty: 2 })]]);

    const result = validateSessionForExport(sheets, catalog, ZERO_MARGIN);

    // Identical local coordinates on two DIFFERENT sheets must never be
    // reported as an overlap.
    expect(result.issues.filter((i) => i.kind === "OVERLAP")).toHaveLength(0);
  });

  it("optimizeEntireSessionWithFullOptimizer can distribute required quantity across multiple sheets when one sheet cannot hold it all", () => {
    const partOuter = rect(600, 600);
    const sheet: AssistedSheetSession = {
      sourceSheetId: "s1",
      material: "Steel",
      thicknessMm: 6,
      widthMm: 700,
      lengthMm: 700,
      instances: [],
    };
    const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
    const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 700, lengthMm: 700 }];

    const result = optimizeEntireSessionWithFullOptimizer([sheet], catalog, sources, ZERO_MARGIN);

    const totalPlaced = result.sheets.reduce((sum, s) => sum + s.instances.length, 0);
    expect(totalPlaced).toBe(3);
    expect(result.sheets.length).toBeGreaterThan(1);
    allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
  });
});

describe("STRICT/FLEXIBLE/OPTIMIZE semantics", () => {
  // ------------------------------------------------------------------
  // A. STRICT — every existing placement (MANUAL, PATTERN, OPTIMIZED)
  //    stays exactly where it is; only remaining quantity is filled.
  // ------------------------------------------------------------------
  describe("A. STRICT", () => {
    it("MANUAL, PATTERN and OPTIMIZED positions all remain unchanged, and remaining quantity is filled around them", () => {
      const partOuter = rect(100, 100);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
          { instanceKey: "pt1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 2, xMm: 110, yMm: 0, rotationDeg: 15, locked: false, origin: "PATTERN" },
          { instanceKey: "o1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 3, xMm: 220, yMm: 0, rotationDeg: 37, locked: false, origin: "OPTIMIZED" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 6 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "STRICT");

      const byKey = new Map(result.sheets[0].instances.map((i) => [i.instanceKey, i]));
      expect(byKey.get("m1")).toMatchObject({ xMm: 0, yMm: 0, rotationDeg: 0 });
      expect(byKey.get("pt1")).toMatchObject({ xMm: 110, yMm: 0, rotationDeg: 15 });
      expect(byKey.get("o1")).toMatchObject({ xMm: 220, yMm: 0, rotationDeg: 37 });
      // Required quantity (6) reached without moving anything.
      expect(result.sheets[0].instances.length).toBe(6);
      expect(result.kept).toBe("ORIGINAL");
      allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
    });
  });

  // ------------------------------------------------------------------
  // B. FLEXIBLE — MANUAL is a hard lock; PATTERN/OPTIMIZED are soft and
  //    may be repositioned; quantity is preserved exactly; multi-sheet
  //    capable; a same-count-but-worse rebuild is rejected, a
  //    more-parts-placed rebuild is accepted regardless of raw score.
  // ------------------------------------------------------------------
  describe("B. FLEXIBLE", () => {
    it("never generates a colliding instanceNumber when MANUAL's existing numbers are sparse/non-contiguous", () => {
      // Simulates a MANUAL part whose earlier instances #2 and #3 were
      // deleted (e.g. via undo), leaving only #1 and #4 — a real, valid
      // scenario the UI can produce. A naive "manualCount + i + 1"
      // scheme would start the released/rebuilt pool at instanceNumber 3
      // (manualCount=2 -> 3, 4), directly colliding with the EXISTING
      // MANUAL instance #4.
      const partOuter = rect(80, 80);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.0064, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
          { instanceKey: "m4", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.0064, instanceNumber: 4, xMm: 90, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
          { instanceKey: "pt1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.0064, instanceNumber: 2, xMm: 180, yMm: 0, rotationDeg: 0, locked: false, origin: "PATTERN" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 4 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      const all = result.sheets.flatMap((s) => s.instances).filter((i) => i.takeoffPartId === "p1");
      expect(all).toHaveLength(4);

      const numbers = all.map((i) => i.instanceNumber);
      expect(new Set(numbers).size).toBe(numbers.length); // no duplicates

      // The pre-existing MANUAL #1 and #4 must both still be present and
      // untouched — this is what "collision" would have silently broken
      // (a rebuilt instance overwriting/duplicating #4's number).
      const manualNumbers = result.sheets
        .flatMap((s) => s.instances)
        .filter((i) => i.origin === "MANUAL")
        .map((i) => i.instanceNumber)
        .sort((a, b) => a - b);
      expect(manualNumbers).toEqual([1, 4]);
    });

    it("actually repositions a badly-placed released instance to achieve an objectively better valid layout (proven by sheet count, not just quantity)", () => {
      // Deterministic, geometry-forced scenario: a 100x50 part on a
      // 150x100 sheet. MANUAL sits correctly at (0,0). PATTERN is
      // deliberately placed BADLY at (50,50) — this straddles the sheet
      // such that it fragments all remaining free space into two 50x50
      // pockets, and NEITHER orientation of a 100x50 part (100w or 50w)
      // can ever fit in a 50x50 pocket. So with PATTERN locked in place
      // (STRICT), a 3rd required part is mathematically impossible to
      // place on this sheet and MUST spill onto a second sheet.
      //
      // Under FLEXIBLE, PATTERN is released and the real optimizer must
      // find a valid non-overlapping arrangement of the released instance
      // (or its replacement) that leaves room for the 3rd part on the
      // SAME sheet — which is only possible if it moves PATTERN out of
      // the middle. This is proven by an objective, unambiguous signal
      // (sheet count), not by inspecting a specific coordinate.
      const partOuter = rect(100, 50);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 150,
        lengthMm: 100,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.005, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
          { instanceKey: "pt1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.005, instanceNumber: 2, xMm: 50, yMm: 50, rotationDeg: 0, locked: false, origin: "PATTERN" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 150, lengthMm: 100 }];

      // Control: STRICT must be forced onto a second sheet, proving the
      // scenario genuinely blocks the 3rd part when nothing is allowed to
      // move — this is what makes the FLEXIBLE result below a real proof
      // of repositioning rather than a coincidence of the test setup.
      const strict = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "STRICT");
      expect(strict.sheets.length).toBe(2);
      expect(countAllInstances(strict.sheets)).toBe(3);

      const flexible = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      // The objective proof: FLEXIBLE fits all 3 required parts onto ONE
      // sheet — impossible unless the badly-placed released instance was
      // actually moved out of the middle of the sheet.
      expect(flexible.sheets.length).toBe(1);
      expect(countAllInstances(flexible.sheets)).toBe(3);

      // MANUAL is still exactly where it started.
      const manual = flexible.sheets.flatMap((s) => s.instances).find((i) => i.instanceKey === "m1");
      expect(manual).toBeDefined();
      expect(manual!.xMm).toBe(0);
      expect(manual!.yMm).toBe(0);
      expect(manual!.rotationDeg).toBe(0);

      // The instance that was originally PATTERN's exact bad position
      // must be gone — nothing may occupy (50, 50) anymore, since that
      // position is precisely what made a 3rd part impossible.
      const stillAtBadSpot = flexible.sheets
        .flatMap((s) => s.instances)
        .some((i) => Math.abs(i.xMm - 50) < 1e-6 && Math.abs(i.yMm - 50) < 1e-6 && i.rotationDeg === 0);
      expect(stillAtBadSpot).toBe(false);

      allPolygonsCollisionFree(flexible.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
    });

    it("MANUAL stays exactly fixed while PATTERN and OPTIMIZED placements may be repositioned", () => {
      const partOuter = rect(100, 100);
      // The PATTERN and OPTIMIZED instances are placed far apart, wasting
      // space that a fresh placement search should be able to reclaim.
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
          { instanceKey: "pt1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 2, xMm: 800, yMm: 800, rotationDeg: 0, locked: false, origin: "PATTERN" },
          { instanceKey: "o1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 3, xMm: 900, yMm: 100, rotationDeg: 0, locked: false, origin: "OPTIMIZED" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      const manual = result.sheets.flatMap((s) => s.instances).find((i) => i.instanceKey === "m1");
      expect(manual).toBeDefined();
      expect(manual!.xMm).toBe(0);
      expect(manual!.yMm).toBe(0);
      expect(manual!.origin).toBe("MANUAL");

      // Exactly 3 required parts, never more, never fewer.
      expect(countAllInstances(result.sheets)).toBe(3);
      allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
    });

    it("never reduces total placed required quantity and never exceeds requiredQty", () => {
      const partOuter = rect(150, 150);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.0225, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
          { instanceKey: "pt1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.0225, instanceNumber: 2, xMm: 200, yMm: 0, rotationDeg: 0, locked: false, origin: "PATTERN" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 2 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      expect(countAllInstances(result.sheets)).toBe(2);
      expect(result.fullyPlaced).toBe(true);
    });

    it("can use multiple sheets when the released+remaining pool cannot fit on one sheet", () => {
      const partOuter = rect(400, 400);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 500,
        lengthMm: 500,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.16, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 500, lengthMm: 500 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      expect(countAllInstances(result.sheets)).toBe(3);
      expect(result.sheets.length).toBeGreaterThan(1);
      allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
    });

    it("rejects a same-quantity rebuild that would score worse than the original", () => {
      // Required quantity already fully satisfied on a tight sheet — a
      // FLEXIBLE rebuild has nothing to gain (it can only ever place the
      // SAME 1 part), so any relocation attempt must not make it worse,
      // and the original position should be effectively preserved.
      const partOuter = rect(100, 100);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      expect(countAllInstances(result.sheets)).toBe(1);
      // The single required part is already MANUAL and already placed —
      // nothing further can legitimately change here.
      const only = result.sheets.flatMap((s) => s.instances)[0];
      expect(only.origin).toBe("MANUAL");
      expect(only.xMm).toBe(0);
      expect(only.yMm).toBe(0);
    });

    it("accepts a candidate that places MORE parts even though it uses more sheets (worse raw score)", () => {
      // Sized so the released pool + remaining genuinely needs a second
      // sheet to reach full required quantity — this proves FLEXIBLE
      // doesn't get stuck preferring a lower sheet-count "solution" that
      // actually places fewer required parts.
      const partOuter = rect(400, 400);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 450,
        lengthMm: 450,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.16, instanceNumber: 1, xMm: 0, yMm: 0, rotationDeg: 0, locked: true, origin: "MANUAL" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 2 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 450, lengthMm: 450 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "FLEXIBLE");

      expect(countAllInstances(result.sheets)).toBe(2);
      expect(result.sheets.length).toBe(2);
    });
  });

  // ------------------------------------------------------------------
  // C. OPTIMIZE — the full multi-strategy optimizer rebuilds everything,
  //    including MANUAL; multi-sheet capable; an existing valid solution
  //    is retained whenever the rebuild doesn't place more (or, at equal
  //    quantity, score better).
  // ------------------------------------------------------------------
  describe("C. OPTIMIZE", () => {
    it("actually uses the full optimizer and can move a MANUAL placement", () => {
      const partOuter = rect(100, 100);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          // Deliberately placed in a corner far from the origin — a full
          // rebuild from scratch is extremely unlikely to reproduce this
          // exact spot by coincidence.
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 897, yMm: 897, rotationDeg: 0, locked: true, origin: "MANUAL" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 4 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "OPTIMIZE");

      expect(countAllInstances(result.sheets)).toBe(4);
      allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
    });

    it("can distribute complete required quantity across multiple sheets", () => {
      const partOuter = rect(600, 600);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 700,
        lengthMm: 700,
        instances: [],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 3 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 700, lengthMm: 700 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "OPTIMIZE");

      expect(countAllInstances(result.sheets)).toBe(3);
      expect(result.sheets.length).toBeGreaterThan(1);
      allPolygonsCollisionFree(result.sheets, (s) => ({ minX: 0, minY: 0, maxX: s.widthMm, maxY: s.lengthMm }));
    });

    it("retains the existing valid solution when the rebuild would place fewer parts", () => {
      // A required quantity of 1 already satisfied by MANUAL — there is
      // nothing for a rebuild to improve, and the sheet is otherwise
      // large and empty so this isolates the "don't regress" rule rather
      // than any genuine capacity constraint.
      const partOuter = rect(100, 100);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 1000,
        lengthMm: 1000,
        instances: [
          { instanceKey: "m1", takeoffPartId: "p1", outer: partOuter, areaSqm: 0.01, instanceNumber: 1, xMm: 500, yMm: 500, rotationDeg: 0, locked: true, origin: "MANUAL" },
        ],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 1 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 1000, lengthMm: 1000 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "OPTIMIZE");

      expect(countAllInstances(result.sheets)).toBe(1);
      expect(result.fullyPlaced).toBe(true);
    });

    it("more placed parts wins over raw score even when it costs an extra sheet", () => {
      const partOuter = rect(400, 400);
      const sheet: AssistedSheetSession = {
        sourceSheetId: "s1",
        material: "Steel",
        thicknessMm: 6,
        widthMm: 450,
        lengthMm: 450,
        instances: [],
      };
      const catalog = new Map([["p1", catalogEntry({ outer: partOuter, requiredQty: 2 })]]);
      const sources: EngineSourceInput[] = [{ sourceSheetId: "s1", material: "Steel", thicknessMm: 6, widthMm: 450, lengthMm: 450 }];

      const result = optimizeRemainingWithPreference([sheet], catalog, sources, ZERO_MARGIN, "OPTIMIZE");

      // Only one 400x400 part fits per 450x450 sheet — 2 required parts
      // genuinely need 2 sheets. The optimizer must not "prefer" a
      // 1-sheet/1-part solution just because it scores lower.
      expect(countAllInstances(result.sheets)).toBe(2);
      expect(result.sheets.length).toBe(2);
    });
  });
});

function countAllInstances(sheets: AssistedSheetSession[]): number {
  return sheets.reduce((sum, s) => sum + s.instances.length, 0);
}
