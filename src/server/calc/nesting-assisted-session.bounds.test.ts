import { describe, expect, it } from "vitest";
import { usableBoundsFor, validateSessionForExport, type AssistedSheetSession, type SessionPartCatalogEntry } from "./nesting-assisted-session";
import { makeWorkingSheet } from "./nesting-optimizer";
import { writeNestingSheetDxf } from "./nesting-dxf-writer";
import type { EngineConfig, EngineSourceInput } from "./nesting-engine";
import type { Point } from "./dxf";

// Phase 0 regression: usableBoundsFor() used to derive X from widthMm and Y
// from lengthMm — the opposite of the rest of the project. The existing
// assisted-session tests all use SQUARE sheets, where the swap is invisible,
// so it survived. These tests use a non-square 1250 × 2500 sheet.
//
// Project convention (optimizer makeWorkingSheet, DXF export, sheet preview):
//   X axis = sheet.lengthMm (2500)      Y axis = sheet.widthMm (1250)
//   margins: left/right → X, bottom/top → Y

const SHEET = { widthMm: 1250, lengthMm: 2500 };

// Deliberately four DIFFERENT margins, so a left/right or top/bottom mix-up
// (not only a width/length one) is caught too.
const MARGINS: EngineConfig = { marginLeftMm: 10, marginRightMm: 20, marginBottomMm: 30, marginTopMm: 40, partGapMm: 0 };

const SOURCE: EngineSourceInput = { sourceSheetId: "s1", material: "Steel", thicknessMm: 6, ...SHEET };

function rect(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function sessionWith(instances: { x: number; y: number; w: number; h: number }[]): AssistedSheetSession {
  return {
    sourceSheetId: "s1",
    material: "Steel",
    thicknessMm: 6,
    ...SHEET,
    instances: instances.map((p, i) => ({
      instanceKey: `k${i}`,
      takeoffPartId: "p1",
      outer: rect(p.w, p.h),
      areaSqm: (p.w * p.h) / 1_000_000,
      instanceNumber: i + 1,
      xMm: p.x,
      yMm: p.y,
      rotationDeg: 0,
      locked: false,
      origin: "MANUAL" as const,
    })),
  };
}

// requiredQty = number of instances so QUANTITY_SHORTFALL never muddies the
// issue list — these tests are only about OUTSIDE_MARGIN.
function catalogFor(qty: number): Map<string, SessionPartCatalogEntry> {
  return new Map([["p1", { takeoffPartId: "p1", itemNo: 1, outer: rect(100, 100), areaSqm: 0.01, requiredQty: qty }]]);
}

function outsideMarginIssues(instances: { x: number; y: number; w: number; h: number }[]) {
  const result = validateSessionForExport([sessionWith(instances)], catalogFor(instances.length), MARGINS);
  return result.issues.filter((i) => i.kind === "OUTSIDE_MARGIN");
}

describe("usableBoundsFor — axis convention on a non-square 1250 × 2500 sheet", () => {
  it("X spans lengthMm (2500) and Y spans widthMm (1250), each shrunk by its own margins", () => {
    const b = usableBoundsFor(SHEET, MARGINS);
    expect(b).toEqual({
      minX: 10, // marginLeft
      minY: 30, // marginBottom
      maxX: 2500 - 20, // lengthMm - marginRight
      maxY: 1250 - 40, // widthMm - marginTop
    });
  });

  it("matches the optimizer's makeWorkingSheet() bounds exactly", () => {
    const b = usableBoundsFor(SHEET, MARGINS);
    const w = makeWorkingSheet(SOURCE, MARGINS);
    expect({ minX: w.minX, minY: w.minY, maxX: w.maxX, maxY: w.maxY }).toEqual(b);
  });

  it("matches the DXF export's MARGIN layer rectangle", () => {
    const b = usableBoundsFor(SHEET, MARGINS);
    const dxf = writeNestingSheetDxf({
      runId: "r1",
      sheetNumber: 1,
      ...SHEET,
      marginLeftMm: MARGINS.marginLeftMm,
      marginRightMm: MARGINS.marginRightMm,
      marginTopMm: MARGINS.marginTopMm,
      marginBottomMm: MARGINS.marginBottomMm,
      placements: [],
    });

    // Pull the vertices of the (only) LWPOLYLINE on layer MARGIN.
    const lines = dxf.split(/\r?\n/);
    const start = lines.findIndex((l, i) => l.trim() === "LWPOLYLINE" && lines[i + 2]?.trim() === "MARGIN");
    expect(start).toBeGreaterThanOrEqual(0);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = start + 1; i < lines.length && lines[i].trim() !== "LWPOLYLINE" && lines[i].trim() !== "ENDSEC"; i++) {
      if (lines[i].trim() === "10") xs.push(parseFloat(lines[i + 1]));
      if (lines[i].trim() === "20") ys.push(parseFloat(lines[i + 1]));
    }
    expect({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }).toEqual(b);
  });
});

describe("validateSessionForExport — bounds on a non-square 1250 × 2500 sheet", () => {
  it("accepts a part far along X (x = 2300..2400 is inside the 2500 length; it was wrongly rejected when X used the 1250 width)", () => {
    expect(outsideMarginIssues([{ x: 2300, y: 100, w: 100, h: 100 }])).toHaveLength(0);
  });

  it("accepts a part that fills the usable area exactly (10..2480 × 30..1210)", () => {
    expect(outsideMarginIssues([{ x: 10, y: 30, w: 2470, h: 1180 }])).toHaveLength(0);
  });

  it("rejects a part whose X extent crosses lengthMm - marginRight (2480)", () => {
    expect(outsideMarginIssues([{ x: 2400, y: 100, w: 100, h: 100 }])).toHaveLength(1);
  });

  it("rejects a part whose Y extent crosses widthMm - marginTop (1210) (it was wrongly accepted when Y used the 2500 length)", () => {
    expect(outsideMarginIssues([{ x: 100, y: 1150, w: 100, h: 100 }])).toHaveLength(1);
  });

  it("rejects a part entirely beyond the sheet width in Y (y = 1300 > 1250)", () => {
    expect(outsideMarginIssues([{ x: 100, y: 1300, w: 100, h: 100 }])).toHaveLength(1);
  });

  it("honours left/bottom margins (x < marginLeft and y < marginBottom are outside)", () => {
    expect(outsideMarginIssues([{ x: 5, y: 100, w: 100, h: 100 }])).toHaveLength(1);
    expect(outsideMarginIssues([{ x: 100, y: 25, w: 100, h: 100 }])).toHaveLength(1);
  });

  it("gives the same verdict for every placement the optimizer's own bounds accept or reject", () => {
    const w = makeWorkingSheet(SOURCE, MARGINS);
    const probes = [
      { x: w.minX, y: w.minY, w: 100, h: 100 }, // corner, inside
      { x: w.maxX - 100, y: w.maxY - 100, w: 100, h: 100 }, // opposite corner, inside
      { x: w.maxX - 99, y: w.minY, w: 100, h: 100 }, // 1 mm over in X
      { x: w.minX, y: w.maxY - 99, w: 100, h: 100 }, // 1 mm over in Y
      { x: w.minX - 1, y: w.minY, w: 100, h: 100 }, // 1 mm under in X
      { x: w.minX, y: w.minY - 1, w: 100, h: 100 }, // 1 mm under in Y
    ];
    for (const p of probes) {
      const optimizerSaysInside = p.x >= w.minX && p.y >= w.minY && p.x + p.w <= w.maxX && p.y + p.h <= w.maxY;
      expect(outsideMarginIssues([p]).length === 0).toBe(optimizerSaysInside);
    }
  });
});
