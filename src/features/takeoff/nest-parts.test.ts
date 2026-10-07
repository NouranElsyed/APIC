import { describe, expect, it } from "vitest";
import { parseDxf } from "@/server/calc/dxf";
import { importableParts } from "@/server/calc/dxf-import";
import { nestPartDescription, nestPartFileName, nestPartToDxf, parseNestParts } from "./nest-parts";

const rect = (w: number, h: number, ox = 0, oy = 0): [number, number][] => [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h]];
const circle = (cx: number, cy: number, r: number, n = 72): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as [number, number]);

const snapshot = {
  v: 1,
  groups: [
    { id: 1, sn: 1, name: "8.dxf", qty: 2, th: 8, material: "st37", outer: rect(600, 300), holes: [circle(300, 150, 50)], w: 600, h: 300, area: 1, per: 1 },
    { id: 2, sn: 2, name: "Rectangle 500×300", qty: 3, th: 0, material: "", outer: rect(500, 300, 10, 20), holes: [], w: 500, h: 300, area: 1, per: 1 },
    { id: 3, sn: 3, name: "paired", cid: 1, qty: 1, th: 8, material: "", outer: rect(10, 10), holes: [], w: 10, h: 10, area: 1, per: 1 },
    { id: 4, sn: 4, name: "none left", qty: 0, th: 8, material: "", outer: rect(10, 10), holes: [], w: 10, h: 10, area: 1, per: 1 },
    { id: 5, sn: 5, name: "broken", qty: 1, th: 8, material: "", outer: [[0, 0], [1, 1]], holes: [], w: 1, h: 1, area: 1, per: 1 },
  ],
};

describe("nest parts -> Standard Calculations", () => {
  it("reads usable 2D parts and recomputes size and net area from the outline", () => {
    const parts = parseNestParts(snapshot);
    expect(parts.map((p) => p.id)).toEqual([1, 2]); // paired copy, qty 0 and broken outline are skipped
    const [a, b] = parts;
    expect([a.w, a.h, a.qty, a.th, a.material]).toEqual([600, 300, 2, 8, "st37"]);
    expect(a.holes).toHaveLength(1);
    expect(a.area).toBeCloseTo(600 * 300 - (72 / 2) * 50 * 50 * Math.sin((2 * Math.PI) / 72), 3);
    expect([b.w, b.h, b.th, b.material]).toEqual([500, 300, 0, ""]);
  });

  it("is safe with anything that is not a nest snapshot", () => {
    for (const bad of [null, undefined, 5, "x", {}, { groups: "no" }, { groups: [null, 3, {}] }]) expect(parseNestParts(bad)).toEqual([]);
  });

  it("names: size is added to file names, not to names that already show one", () => {
    const [a, b] = parseNestParts(snapshot);
    expect(nestPartDescription(a)).toBe("8 600×300");
    expect(nestPartDescription(b)).toBe("Rectangle 500×300");
    expect(nestPartFileName(a)).toBe("8 600×300.dxf");
    expect(nestPartFileName({ name: "a/b:c", w: 10, h: 20 })).toBe("a-b-c 10×20.dxf");
  });

  it("the generated DXF is read back by the Standard Calculations importer with the same size, area and holes", () => {
    for (const p of parseNestParts(snapshot)) {
      const parsed = parseDxf(nestPartToDxf(p));
      expect(parsed.valid).toBe(true);
      const list = importableParts(parsed);
      expect(list).toHaveLength(1);
      expect(list[0].bboxWidthMm).toBeCloseTo(p.w, 2);
      expect(list[0].bboxHeightMm).toBeCloseTo(p.h, 2);
      expect(list[0].areaSqm * 1e6).toBeCloseTo(p.area, 0);
      expect(list[0].holes).toHaveLength(p.holes.length);
    }
  });
});
