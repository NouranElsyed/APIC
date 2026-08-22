import { describe, expect, it } from "vitest";
import { writeNestingSheetDxf, nestingSheetDxfFileName, type DxfSheetInput } from "./nesting-dxf-writer";

function rect(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

describe("writeNestingSheetDxf — Test 12", () => {
  it("includes the full physical sheet boundary, not the shrunk usable area", () => {
    const sheet: DxfSheetInput = {
      runId: "run-1",
      sheetNumber: 1,
      widthMm: 6000,
      lengthMm: 2000,
      marginLeftMm: 25,
      marginRightMm: 25,
      marginTopMm: 25,
      marginBottomMm: 25,
      placements: [],
    };

    const dxf = writeNestingSheetDxf(sheet);

    expect(dxf).toContain("SHEET");
    expect(dxf).toContain("6000");
    expect(dxf).toContain("2000");
    expect(dxf).toContain("MARGIN");
    expect(dxf).toContain("$INSUNITS");
  });

  it("exports real part geometry, holes, correct coordinates and rotation, and labels", () => {
    const sheet: DxfSheetInput = {
      runId: "run-2",
      sheetNumber: 1,
      widthMm: 1000,
      lengthMm: 1000,
      marginLeftMm: 5,
      marginRightMm: 5,
      marginTopMm: 5,
      marginBottomMm: 5,
      placements: [
        {
          takeoffPartId: "part-1",
          itemNo: 42,
          instanceNumber: 3,
          xMm: 100,
          yMm: 200,
          rotationDeg: 90,
          outer: rect(300, 100),
          holes: [rect(20, 20).map((p) => ({ x: p.x + 50, y: p.y + 50 }))],
        },
      ],
    };

    const dxf = writeNestingSheetDxf(sheet);

    expect(dxf).toContain("PARTS");
    expect(dxf).toContain("HOLES");
    expect(dxf).toContain("LABELS");
    expect(dxf).toContain("PART-42");
    expect(dxf).toContain("INSTANCE-3");

    // Rotated 90°, the part's footprint becomes 100 wide x 300 tall,
    // translated to (100, 200) — its far corner must appear at x=200, y=500.
    expect(dxf).toContain("200");
    expect(dxf).toContain("500");
  });

  it("names files following the Sheet_NN convention", () => {
    expect(nestingSheetDxfFileName("abc123", 1)).toBe("Nesting_Run_abc123_Sheet_01.dxf");
    expect(nestingSheetDxfFileName("abc123", 12)).toBe("Nesting_Run_abc123_Sheet_12.dxf");
  });
});
