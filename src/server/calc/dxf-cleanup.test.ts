import { describe, expect, it } from "vitest";
import { parseDxf } from "./dxf";

// Import clean-up: tails, duplicates, overlaps and T-junctions must not stop
// a drawn outline from closing (no manual OVERKILL needed).

function buildDxf(entities: string[]): string {
  return ["0", "SECTION", "2", "ENTITIES"].join("\n") + "\n" + entities.join("") + ["0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
}
function line(x1: number, y1: number, x2: number, y2: number): string {
  return ["0", "LINE", "8", "0", "10", String(x1), "20", String(y1), "11", String(x2), "21", String(y2)].join("\n") + "\n";
}

/** 100 × 50 rectangle, bottom edge drawn as separate pieces by the callers. */
const top = line(100, 50, 0, 50);
const left = line(0, 50, 0, 0);
const right = line(100, 0, 100, 50);

describe("DXF import clean-up", () => {
  it("baseline: a clean rectangle closes", () => {
    const r = parseDxf(buildDxf([line(0, 0, 100, 0), right, top, left]));
    expect(r.valid).toBe(true);
    expect(r.areaSqm).toBeCloseTo(0.005, 9);
  });

  it("a bottom line that runs past the corner (tail, like the screenshot) is trimmed", () => {
    const r = parseDxf(buildDxf([line(-30, 0, 100, 0), right, top, left]));
    expect(r.valid).toBe(true);
    expect(r.areaSqm).toBeCloseTo(0.005, 9);
    expect(r.bboxWidthMm).toBeCloseTo(100, 6);
  });

  it("tails at both ends and on several corners", () => {
    const r = parseDxf(
      buildDxf([line(-10, 0, 120, 0), line(100, -5, 100, 70), line(130, 50, -20, 50), line(0, 80, 0, -15)]),
    );
    expect(r.valid).toBe(true);
    expect(r.areaSqm).toBeCloseTo(0.005, 9);
  });

  it("a duplicated line and a partially overlapping collinear line are collapsed", () => {
    const r = parseDxf(
      buildDxf([line(0, 0, 70, 0), line(40, 0, 100, 0), line(0, 0, 100, 0), right, top, top, left]),
    );
    expect(r.valid).toBe(true);
    expect(r.areaSqm).toBeCloseTo(0.005, 9);
  });

  it("a line ending in the middle of another (T-junction) with a whisker is ignored", () => {
    const r = parseDxf(buildDxf([line(0, 0, 100, 0), right, top, left, line(50, 0, 50, -20)]));
    expect(r.valid).toBe(true);
    expect(r.areaSqm).toBeCloseTo(0.005, 9);
  });

  it("endpoints 0.03 mm apart that straddle a grid border still join", () => {
    const r = parseDxf(buildDxf([line(0, 0, 100, 0), line(100.03, 0.02, 100, 50), top, left]));
    expect(r.valid).toBe(true);
  });

  it("a truly open shape is still reported as open", () => {
    const r = parseDxf(buildDxf([line(0, 0, 100, 0), right, top]));
    expect(r.valid).toBe(false);
    expect(r.errorMessage).toMatch(/open contour/i);
  });
});
