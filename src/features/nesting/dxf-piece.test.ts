import { describe, expect, it } from "vitest";
import { detectDxfUnits, dxfToPiece } from "./dxf-piece";

/** Minimal ASCII DXF: a closed rectangle w x h drawn with 4 LINEs. */
function rectDxf(w: number, h: number, insunits?: number): string {
  const pair = (c: number, v: string | number) => `${c}\n${v}\n`;
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    pair(0, "LINE") + pair(8, "0") + pair(10, x0) + pair(20, y0) + pair(11, x1) + pair(21, y1);
  const header = insunits === undefined ? "" : pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$INSUNITS") + pair(70, insunits) + pair(0, "ENDSEC");
  return (
    header +
    pair(0, "SECTION") + pair(2, "ENTITIES") +
    line(0, 0, w, 0) + line(w, 0, w, h) + line(w, h, 0, h) + line(0, h, 0, 0) +
    pair(0, "ENDSEC") + pair(0, "EOF")
  );
}

describe("dxfToPiece", () => {
  it("uses the longer side as the cut length, whatever the orientation", () => {
    const a = dxfToPiece(rectDxf(2450, 50), "Bar 1.dxf", null);
    const b = dxfToPiece(rectDxf(50, 2450), "Bar 2.dxf", null);
    expect(a).toMatchObject({ name: "Bar 1", length: 2450, width: 50 });
    expect(b).toMatchObject({ name: "Bar 2", length: 2450, width: 50 });
  });
  it("reads the units from the header and converts to mm", () => {
    expect(detectDxfUnits(rectDxf(1, 1, 6))).toEqual({ label: "m", scale: 1000 });
    expect(dxfToPiece(rectDxf(2.45, 0.05, 6), "a.dxf", null)).toMatchObject({ length: 2450 });
    expect(dxfToPiece(rectDxf(10, 2, 1), "a.dxf", null)).toMatchObject({ length: 254 });
  });
  it("lets the user override the units", () => {
    expect(dxfToPiece(rectDxf(245, 5, 4), "a.dxf", 10)).toMatchObject({ length: 2450 });
  });
  it("reports files without a closed outline", () => {
    expect(dxfToPiece("0\nEOF\n", "empty.dxf", null)).toEqual({ error: "no closed outline found" });
  });
});
