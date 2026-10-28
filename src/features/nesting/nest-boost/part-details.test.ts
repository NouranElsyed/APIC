import { describe, expect, it } from "vitest";
import { partDetails } from "./part-details";
import type { Group } from "./engine";

const rect = (w: number, h: number): [number, number][] => [[0, 0], [w, 0], [w, h], [0, h]];

describe("partDetails", () => {
  it("net area = outline − holes, weight = m² × mm × 7.85", () => {
    const g = { id: 1, sn: 1, name: "p", qty: 3, th: 10, material: "", outer: rect(1000, 500), holes: [rect(100, 100)], w: 1000, h: 500, area: 490000, per: 3600 } as Group;
    const d = partDetails(g, 1, 2);
    expect(d.holesMm2).toBe(10000);
    expect(d.outlineMm2).toBe(500000);
    expect(d.unitKg).toBeCloseTo(0.49 * 10 * 7.85, 6);
    expect(d.totalKg).toBeCloseTo(0.49 * 10 * 7.85 * 3, 6);
    expect(d.leftKg).toBeCloseTo(0.49 * 10 * 7.85 * 2, 6);
  });
  it("no thickness → no weight", () => {
    const g = { id: 1, sn: 1, name: "p", qty: 1, th: 0, material: "", outer: rect(10, 10), holes: [], w: 10, h: 10, area: 100, per: 40 } as Group;
    expect(partDetails(g, 0, 1).unitKg).toBeNull();
  });
});
