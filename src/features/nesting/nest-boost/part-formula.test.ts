import { describe, expect, it } from "vitest";
import { addManualPart, buildManualShape, resizeGroup, type Counters, type ManualShape } from "./engine";
import { formulaFromShape, holeLines, shapeFormula } from "./part-formula";

const shapes: ManualShape[] = [
  { kind: "rect", w: 500, h: 300, hole: 50 },
  { kind: "circle", d: 400, hole: 100 },
  { kind: "triangle", a: 300, b: 400, angle: 90 },
  { kind: "trapezoid", a: 500, b: 300, h: 200 },
  { kind: "cone", d1: 1000, d2: 400, h: 800 },
  { kind: "cone", d1: 1000, d2: 0, h: 800 },
  { kind: "cylinder", d: 500, h: 1000 },
  { kind: "cylpart", r: 2958, h: 2217, by: "angle", v: 90 },
  { kind: "cylpart", r: 1000, h: 500, h2: 800, by: "angle", v: 60 },
  { kind: "arc", r: 500, w: 100, angle: 90 },
  { kind: "arc", r: 0, w: 300, angle: 60 },
];

describe("formulaFromShape", () => {
  it.each(shapes.map((s, i) => [i, s] as const))("shape %i: exact formula matches the drawn outline", (_i, s) => {
    const geo = buildManualShape(s);
    if ("error" in geo) throw new Error(geo.error);
    const fo = formulaFromShape(s);
    expect(fo).not.toBeNull();
    // polygon approximation of arcs/circles is within 0.2% of the exact formula
    expect(Math.abs(fo!.formulaMm2! - geo.area) / geo.area).toBeLessThan(0.002);
  });

  it("cylinder part R2958 90° gives the 4646.42 mm flat length", () => {
    const fo = formulaFromShape({ kind: "cylpart", r: 2958, h: 2217, by: "angle", v: 90 })!;
    expect(fo.steps.join("\n")).toContain("4,646.42");
  });
});

describe("shape bookkeeping", () => {
  const counters = (): Counters => ({ id: 1, sn: 0 } as Counters);
  it("a typed-in part remembers its shape; a resized one falls back to recognition", () => {
    const r = addManualPart([], { kind: "rect", w: 100, h: 50 }, { th: 5, material: "", qty: 1 }, counters());
    if ("error" in r) throw new Error(r.error);
    const g = r.groups[0];
    expect(g.shape?.kind).toBe("rect");
    const g2 = resizeGroup(g, 200, 50);
    expect(g2.shape).toBeUndefined();
    expect(shapeFormula(g2)?.title).toBe("Rectangle");
    expect(shapeFormula(g2)?.source).toBe("detected");
  });
  it("groups round holes by diameter", () => {
    const geo = buildManualShape({ kind: "rect", w: 500, h: 300, hole: 50 });
    if ("error" in geo) throw new Error(geo.error);
    const l = holeLines(geo.holes);
    expect(l).toHaveLength(1);
    expect(l[0].d).toBe(50);
  });
});
