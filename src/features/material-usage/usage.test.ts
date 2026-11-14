import { describe, expect, it } from "vitest";
import { buildUsage, cumulativeOrders, groupName, parsePrice, topUsage, type UsagePart } from "./usage";

const part = (o: Partial<UsagePart>): UsagePart => ({ partType: "PLATE", material: "ST37", thicknessMm: 6, weightKg: 1000, buyWeightKg: null, scrapKg: null, ...o });
const prices = { costPerKg: 10, scrapPerKg: 4 };

describe("groupName", () => {
  it("names by type and thickness", () => {
    expect(groupName({ partType: "PLATE", thicknessMm: 6 })).toBe("Steel Plates 6 mm");
    expect(groupName({ partType: "PIPE", thicknessMm: 8.5 })).toBe("Pipes 8.5 mm");
    expect(groupName({ partType: "HOT_ROLLED", thicknessMm: null })).toBe("Steel Sections");
  });
});

describe("buildUsage", () => {
  it("assumes no scrap when no purchase weight was entered", () => {
    const { totals } = buildUsage([part({})], prices);
    expect(totals).toMatchObject({ usedKg: 1000, purchaseKg: 1000, scrapKg: 0, scrapPct: 0, lossPct: 0, trackedParts: 0 });
  });
  it("computes scrap, value and net loss from the purchase weight", () => {
    const { rows, totals } = buildUsage([part({ buyWeightKg: 1100, scrapKg: 100 })], prices);
    expect(rows).toHaveLength(1);
    expect(totals.purchaseKg).toBe(1100);
    expect(totals.scrapKg).toBe(100);
    expect(totals.scrapPct).toBeCloseTo(9.09, 2);
    expect(totals.usedCost).toBe(10000);
    expect(totals.purchaseCost).toBe(11000);
    expect(totals.scrapValue).toBe(400);
    // lost (10-4)*100 = 600 of 11000
    expect(totals.lossPct).toBeCloseTo(5.45, 2);
    expect(totals.trackedParts).toBe(1);
  });
  it("never lets purchase drop below used", () => {
    expect(buildUsage([part({ buyWeightKg: 800 })], prices).totals.purchaseKg).toBe(1000);
  });
  it("groups parts by type, thickness and material and sorts by used weight", () => {
    const { rows } = buildUsage([part({ weightKg: 100 }), part({ weightKg: 300 }), part({ thicknessMm: 10, weightKg: 900 }), part({ material: "st37", weightKg: 50 })], prices);
    expect(rows.map((r) => [r.name, r.usedKg])).toEqual([["Steel Plates 10 mm", 900], ["Steel Plates 6 mm", 450]]);
  });
  it("handles an empty project", () => expect(buildUsage([], prices).totals).toMatchObject({ usedKg: 0, scrapPct: 0, lossPct: 0 }));
});

describe("topUsage", () => {
  it("folds the tail into Others", () => {
    const parts = [1, 2, 3, 4, 5, 6, 7].map((i) => part({ thicknessMm: i, weightKg: i * 1000 }));
    const top = topUsage(buildUsage(parts, prices).rows, 5);
    expect(top).toHaveLength(6);
    expect(top[5]).toEqual({ name: "Others", tons: 3 });
  });
});

describe("cumulativeOrders", () => {
  it("accumulates by month and skips unpriced orders", () => {
    const out = cumulativeOrders([{ date: "2026-10-05", value: 100 }, { date: "2026-09-20", value: 50 }, { date: "2026-10-30", value: 25 }, { date: null, value: 999 }, { date: "2026-11-01", value: null }]);
    expect(out.map((p) => [p.label, p.value])).toEqual([["Sep", 50], ["Oct", 175]]);
  });
});

describe("parsePrice", () => {
  it("falls back for bad input", () => {
    expect(parsePrice("12.5", 1)).toBe(12.5);
    expect(parsePrice("abc", 7)).toBe(7);
    expect(parsePrice("-3", 7)).toBe(7);
  });
});
