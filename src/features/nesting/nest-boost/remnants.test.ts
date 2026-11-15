import { describe, expect, it } from "vitest";
import { findRemnants, remnantLines } from "./remnants";
import type { Group, Settings, Sheet } from "./engine";

const S: Settings = { W: 3000, H: 1500, mg: 10, gp: 5, cell: 10, ro: 0, x0: 0, GW: 300, GH: 150 };
const rectGroup = (w: number, h: number): Group => ({
  id: 1, sn: 1, name: "r", qty: 1, th: 10, material: "ST37",
  outer: [[0, 0], [w, 0], [w, h], [0, h]], holes: [], w, h, area: w * h, per: 2 * (w + h),
});
const sheetWith = (parts: { w: number; h: number; x: number; y: number }[], o: Partial<Sheet> = {}): Sheet => ({
  items: parts.map((p) => ({ g: rectGroup(p.w, p.h), rot: 0, x: p.x, y: p.y })), th: 10, material: "ST37", used: 0, ...o,
});

describe("findRemnants", () => {
  it("an empty sheet is one big remnant inside the margins", () => {
    const r = findRemnants(sheetWith([]), S);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].w).toBeGreaterThanOrEqual(2970);
    expect(r[0].h).toBeGreaterThanOrEqual(1470);
  });
  it("finds the free strip beside a part at the left", () => {
    // part 1000 × 1500 flush left → free: roughly 2000 × 1500 on the right
    const [r] = findRemnants(sheetWith([{ w: 1000, h: 1480, x: 10, y: 10 }]), S);
    expect(r.x).toBeGreaterThanOrEqual(1000);
    expect(r.w).toBeGreaterThanOrEqual(1900);
    expect(r.h).toBeGreaterThanOrEqual(1400);
  });
  it("never overlaps a part", () => {
    const parts = [{ w: 800, h: 700, x: 10, y: 10 }, { w: 900, h: 400, x: 1200, y: 600 }];
    const rem = findRemnants(sheetWith(parts), S, { minSide: 100, minArea: 10000, max: 5 });
    for (const r of rem) for (const p of parts) {
      const overlap = r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y;
      expect(overlap).toBe(false);
    }
    // remnants do not overlap each other either
    for (let i = 0; i < rem.length; i++) for (let j = i + 1; j < rem.length; j++) {
      const a = rem[i], b = rem[j];
      expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
    }
  });
  it("returns nothing when the sheet is full", () => {
    expect(findRemnants(sheetWith([{ w: 2980, h: 1480, x: 10, y: 10 }]), S)).toEqual([]);
  });
  it("ignores slivers below the minimum side", () => {
    const r = findRemnants(sheetWith([{ w: 2700, h: 1480, x: 10, y: 10 }]), S); // 270 mm strip left
    expect(r).toEqual([]);
  });
  it("uses the trimmed sheet size", () => {
    const r = findRemnants(sheetWith([], { W: 1000, H: 800 }), S);
    expect(r[0].w).toBeLessThanOrEqual(1000);
    expect(r[0].h).toBeLessThanOrEqual(800);
  });
});

describe("remnantLines", () => {
  it("groups identical remnants into one line with a quantity", () => {
    const s = () => sheetWith([{ w: 1000, h: 1480, x: 10, y: 10 }]);
    const lines = remnantLines([s(), s()], S);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ thicknessMm: 10, material: "ST37", qty: 2 });
    expect(lines[0].widthMm).toBeGreaterThanOrEqual(lines[0].heightMm);
  });
});
