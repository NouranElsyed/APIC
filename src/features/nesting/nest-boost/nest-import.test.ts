import { describe, expect, it } from "vitest";
import { addNestParts, buildDxf, makeSettings, parseDXF, splitNestLoops, tp, type Group, type Pt, type Sheet } from "./engine";

const S = makeSettings({ W: 2000, H: 1000, mg: 5, gp: 5, cell: 5, ro: 2 });
const poly = (pts: Pt[]): Pt[] => pts;
const mk = (id: number, outer: Pt[], holes: Pt[][] = []): Group => {
  const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
  const w = Math.max(...xs), h = Math.max(...ys);
  return { id, sn: id + 1, name: "p", qty: 1, th: 8, material: "", outer, holes, w, h, area: w * h, per: 2 * (w + h) };
};
const trap = mk(0, poly([[0, 0], [600, 0], [600, 150], [100, 150]]));
const sq = mk(1, poly([[0, 0], [157, 0], [157, 150], [0, 150]]), [[[40, 40], [60, 40], [60, 60], [40, 60]]]);

describe("nest DXF import", () => {
  it("round-trips an exported nest: parts, quantities, rotations and positions", () => {
    const sheets: Sheet[] = [
      { items: [{ g: trap, rot: 0, x: 10, y: 10 }, { g: trap, rot: 180, x: 10, y: 300 }, { g: sq, rot: 90, x: 800, y: 20 }], th: 8, material: "", used: 0 },
      { items: [{ g: sq, rot: 0, x: 50, y: 50 }, { g: trap, rot: 90, x: 400, y: 100 }], th: 8, material: "", used: 0, W: 1500, H: 800 },
    ];
    const r = parseDXF(buildDxf(sheets, S));
    const nest = splitNestLoops(r.loops, 1);
    expect(nest.stray).toBe(0);
    expect(nest.sheets.map((s) => [s.W, s.H])).toEqual([[2000, 1000], [1500, 800]]);
    expect(nest.sheets.map((s) => s.parts.length)).toEqual([3, 2]);
    const a = addNestParts([], nest.sheets, "nest.dxf", { id: 0, sn: 0 }, { th: 8, material: "" });
    expect(a.count).toBe(5);
    expect(a.groups).toHaveLength(2);
    expect(a.groups.map((g) => g.qty).sort()).toEqual([2, 3]);
    const trapRow = a.groups.find((g) => g.holes.length === 0)!;
    expect(trapRow.qty).toBe(3);
    // every item keeps its original rotation and position
    const flat = a.sheets.flatMap((s) => s.items.map((i) => [i.g.holes.length, i.rot, Math.round(i.x), Math.round(i.y)]));
    expect(flat).toEqual([[0, 0, 10, 10], [0, 180, 10, 300], [1, 0, 800, 20], [0, 90, 400, 100], [1, 270, 50, 50]]);
    // every placed outline and hole lands exactly where it was in the exported drawing
    const abs = (sh: Sheet) => sh.items.map((i) => [i.g.outer, ...i.g.holes].map((r) => r.map((p) => { const q = tp(i.g, i.rot, p); return [Math.round(q[0] + i.x), Math.round(q[1] + i.y)]; }).sort((u, v) => u[0] - v[0] || u[1] - v[1]))).map((x) => JSON.stringify(x)).sort();
    a.sheets.forEach((sh, k) => expect(abs(sh)).toEqual(abs(sheets[k])));
  });

  it("returns no sheets for a plain parts file", () => {
    const r = parseDXF(buildDxf([{ items: [], th: 8, material: "", used: 0, W: 100, H: 50 }], S).replace(/ENTITIES[\s\S]*ENDSEC/, "ENTITIES\n0\nENDSEC"));
    expect(splitNestLoops(r.loops, 1).sheets).toHaveLength(0);
  });

  it("reports shapes that cannot be closed (duplicate / overlapping lines)", () => {
    const line = (x1: number, y1: number, x2: number, y2: number) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`;
    const box = (x: number, extra = "") => line(x, 0, x + 100, 0) + line(x + 100, 0, x + 100, 50) + line(x + 100, 50, x, 50) + line(x, 50, x, 0) + extra;
    const dxf = (b: string) => `0\nSECTION\n2\nENTITIES\n${b}0\nENDSEC\n0\nEOF\n`;
    expect(parseDXF(dxf(box(0) + box(300))).unclosed).toHaveLength(0);
    const r = parseDXF(dxf(box(0, line(0, 50, 100, 50)) + box(300) + box(600, line(600, 0, 650, 0))));
    expect(r.loops).toHaveLength(1);
    expect(r.unclosed).toHaveLength(2);
  });
});
