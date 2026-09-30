import { describe, expect, it } from "vitest";
import { parseDxf, extractDxfTexts } from "./dxf";
import { assignLabels, boxOf, classifyText, partToDxf } from "./dxf-labels";
import { importableParts } from "./dxf-import";

const rect = (x: number, y: number, w: number, h: number) =>
  ["0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1", "10", x, "20", y, "10", x + w, "20", y, "10", x + w, "20", y + h, "10", x, "20", y + h];
const text = (s: string, x: number, y: number, h = 20) => ["0", "TEXT", "8", "0", "10", x, "20", y, "40", h, "1", s];
const mtext = (s: string, x: number, y: number, h = 20) => ["0", "MTEXT", "8", "0", "10", x, "20", y, "40", h, "71", "1", "1", s];
const dxfOf = (ent: (string | number)[]) =>
  ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...ent, "0", "ENDSEC", "0", "EOF"].join("\n");

describe("classifyText", () => {
  it("reads thickness and qty", () => {
    expect(classifyText("5 mm")).toEqual({ thicknessMm: 5 });
    expect(classifyText("PL10")).toEqual({ thicknessMm: 10 });
    expect(classifyText("x6")).toEqual({ qty: 6 });
    expect(classifyText("QTY: 6")).toEqual({ qty: 6 });
    expect(classifyText("6 pcs")).toEqual({ qty: 6 });
    expect(classifyText("5mm x6")).toEqual({ thicknessMm: 5, qty: 6 });
    expect(classifyText("PL5 x6")).toEqual({ thicknessMm: 5, qty: 6 });
  });
  it("ignores dimensions and plain marks", () => {
    expect(classifyText("500 x 300")).toEqual({});
    expect(classifyText("10 x 10 mm")).toEqual({});
    expect(classifyText("P1")).toEqual({});
  });
});

describe("multi-part sheet", () => {
  const dxf = dxfOf([
    ...text("5 mm", 0, 500), ...text("10 mm", 1200, 500),
    ...rect(0, 300, 200, 100), ...text("x6", 80, 270),
    ...rect(300, 300, 200, 100), ...mtext("QTY: 2", 380, 270),
    ...rect(700, 300, 200, 100), ...text("3 pcs", 780, 270),
    ...rect(1200, 300, 300, 150), ...text("x4", 1320, 270),
  ]);
  it("gives every group its thickness and every part its qty", () => {
    const parts = importableParts(parseDxf(dxf));
    expect(parts.length).toBe(4);
    const labels = assignLabels(parts.map(boxOf), extractDxfTexts(dxf));
    const byX = parts.map((p, i) => ({ x: boxOf(p).minX, ...labels[i] })).sort((a, b) => a.x - b.x);
    expect(byX).toEqual([
      { x: 0, qty: 6, thicknessMm: 5 },
      { x: 300, qty: 2, thicknessMm: 5 },
      { x: 700, qty: 3, thicknessMm: 5 },
      { x: 1200, qty: 4, thicknessMm: 10 },
    ]);
  });
  it("a single heading applies to every part", () => {
    const one = dxfOf([...text("8mm", 0, 500), ...rect(0, 0, 100, 100), ...rect(300, 0, 100, 100)]);
    const parts = importableParts(parseDxf(one));
    expect(assignLabels(parts.map(boxOf), extractDxfTexts(one)).map((l) => l.thicknessMm)).toEqual([8, 8]);
  });
});

describe("partToDxf", () => {
  it("round-trips a part with a hole", () => {
    const src = dxfOf([...rect(50, 50, 200, 100), ...rect(100, 80, 40, 40)]);
    const [part] = importableParts(parseDxf(src));
    const back = parseDxf(partToDxf(part));
    expect(back.valid).toBe(true);
    expect(back.areaSqm).toBeCloseTo(part.areaSqm, 9);
    expect(back.holeCount).toBe(1);
  });
});
