import { describe, expect, it } from "vitest";
import { parseDxf } from "./dxf";

// ---- small DXF builders -----------------------------------------------

function dxfHeader(): string {
  return ["0", "SECTION", "2", "ENTITIES"].join("\n") + "\n";
}

function dxfFooter(): string {
  return ["0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return [
    "0", "LINE",
    "8", "0",
    "10", String(x1),
    "20", String(y1),
    "11", String(x2),
    "21", String(y2),
  ].join("\n") + "\n";
}

function lwpolyline(pts: { x: number; y: number }[], closed: boolean): string {
  const lines = ["0", "LWPOLYLINE", "8", "0", "90", String(pts.length), "70", closed ? "1" : "0"];
  for (const p of pts) {
    lines.push("10", String(p.x), "20", String(p.y));
  }
  return lines.join("\n") + "\n";
}

function circle(cx: number, cy: number, r: number): string {
  return ["0", "CIRCLE", "8", "0", "10", String(cx), "20", String(cy), "40", String(r)].join("\n") + "\n";
}

function buildDxf(entities: string[]): string {
  return dxfHeader() + entities.join("") + dxfFooter();
}

// ---- tests -------------------------------------------------------------

describe("parseDxf — existing supported geometry (unchanged)", () => {
  it("TEST 1: closed LWPOLYLINE is valid", () => {
    const dxf = buildDxf([
      lwpolyline(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        true
      ),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.outerContourCount).toBe(1);
    expect(result.holeCount).toBe(0);
  });

  it("TEST 2: closed POLYLINE + VERTEX is valid", () => {
    const dxf = buildDxf([
      [
        "0", "POLYLINE", "8", "0", "70", "1",
        "0", "VERTEX", "8", "0", "10", "0", "20", "0",
        "0", "VERTEX", "8", "0", "10", "50", "20", "0",
        "0", "VERTEX", "8", "0", "10", "50", "20", "50",
        "0", "VERTEX", "8", "0", "10", "0", "20", "50",
        "0", "SEQEND",
      ].join("\n") + "\n",
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
  });

  it("TEST 3: circle is valid", () => {
    const dxf = buildDxf([circle(0, 0, 25)]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
  });
});

describe("parseDxf — LINE-based closed contour reconstruction", () => {
  it("TEST 4: closed contour from separate LINE entities", () => {
    const dxf = buildDxf([
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      line(0, 100, 0, 0),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.outerContourCount).toBe(1);
    expect(result.holeCount).toBe(0);
    expect(result.areaSqm).toBeCloseTo(0.01, 6); // 100mm x 100mm = 10000 mm^2 = 0.01 m^2
  });

  it("TEST 5: same contour with some LINE directions reversed", () => {
    const dxf = buildDxf([
      line(0, 0, 100, 0), // P1 -> P2
      line(100, 100, 100, 0), // P3 -> P2 (reversed)
      line(100, 100, 0, 100), // P3 -> P4
      line(0, 0, 0, 100), // P1 -> P4 (reversed)
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.outerContourCount).toBe(1);
    expect(result.areaSqm).toBeCloseTo(0.01, 6);
  });

  it("TEST 6: closed outer LINE contour + inner LINE contour (hole)", () => {
    const dxf = buildDxf([
      // Outer 100x100
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      line(0, 100, 0, 0),
      // Inner hole 20x20 centered
      line(40, 40, 60, 40),
      line(60, 40, 60, 60),
      line(60, 60, 40, 60),
      line(40, 60, 40, 40),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.holeCount).toBe(1);
    // net area = 10000 - 400 = 9600 mm^2 = 0.0096 m^2
    expect(result.areaSqm).toBeCloseTo(0.0096, 6);
  });

  it("TEST 7: open LINE chain is invalid", () => {
    const dxf = buildDxf([
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      // missing closing segment back to (0,0)
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toMatch(/do not form a closed loop/i);
  });

  it("TEST 8: disconnected LINE segments are invalid", () => {
    const dxf = buildDxf([
      line(0, 0, 50, 0),
      line(200, 200, 250, 200),
      line(400, 400, 450, 450),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(false);
  });

  it("TEST 9: valid closed contour + unrelated open construction line", () => {
    const dxf = buildDxf([
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      line(0, 100, 0, 0),
      // unrelated open construction line, far away, not connected to anything
      line(500, 500, 600, 600),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.outerContourCount).toBe(1);
    expect(result.holeCount).toBe(0);
    expect(result.areaSqm).toBeCloseTo(0.01, 6);
  });

  it("TEST 10: existing LWPOLYLINE/POLYLINE/CIRCLE behavior unchanged when mixed with LINE", () => {
    const dxf = buildDxf([
      lwpolyline(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 30 },
          { x: 0, y: 30 },
        ],
        true
      ),
      // A separate closed LINE loop elsewhere — should also be picked up,
      // and since it's smaller than the LWPOLYLINE square it becomes a hole
      // under the existing largest-area-outer classification. To keep this
      // purely about "LWPOLYLINE still works", make it non-overlapping and
      // smaller so it's classified as the (test-irrelevant) hole slot.
      line(1000, 0, 1010, 0),
      line(1010, 0, 1010, 10),
      line(1010, 10, 1000, 10),
      line(1000, 10, 1000, 0),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.outerContourCount).toBe(1);
    expect(result.holeCount).toBe(1); // the small LINE loop, per existing largest=outer/rest=hole rule
  });

  it("zero-length and duplicate LINE segments do not create malformed polygons", () => {
    const dxf = buildDxf([
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      line(0, 100, 0, 0),
      // duplicate of the first edge
      line(0, 0, 100, 0),
      // zero-length line
      line(50, 50, 50, 50),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(true);
    expect(result.outerContourCount).toBe(1);
    expect(result.holeCount).toBe(0);
    expect(result.areaSqm).toBeCloseTo(0.01, 6);
  });

  it("does not connect endpoints beyond the connection tolerance", () => {
    const dxf = buildDxf([
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      // Endpoint deliberately 1mm away from (0,0) — well beyond
      // LINE_CONNECTION_TOLERANCE_MM (0.05mm) — so the loop must NOT close.
      line(0, 100, 1, 0),
    ]);
    const result = parseDxf(dxf);
    expect(result.valid).toBe(false);
  });
});
