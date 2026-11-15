import { describe, it, expect } from "vitest";
import { computeTakeoffPart } from "./takeoff";
import {
  BoqGroupError, effectiveQtyMap, groupedPartQty, planPartQtyUpdates, rollupGroups, splitWeights, wouldCreateCycle,
  type GroupablePart, type GroupNode,
} from "./boq-groups";

const part = (id: string, groupId: string | null, over: Partial<GroupablePart> = {}): GroupablePart => ({
  id, groupId, partType: "PLATE", qty: 1, qtyPerAssembly: 1, weightKg: 0, ...over,
});

describe("effectiveQtyMap", () => {
  it("multiplies through the parents", () => {
    const m = effectiveQtyMap([
      { id: "wall", parentId: null, qty: 4 }, { id: "hatch", parentId: "wall", qty: 2 }, { id: "latch", parentId: "hatch", qty: 3 },
    ]);
    expect([m.get("wall"), m.get("hatch"), m.get("latch")]).toEqual([4, 8, 24]);
  });
  it("throws on a cycle", () => {
    expect(() => effectiveQtyMap([{ id: "a", parentId: "b", qty: 1 }, { id: "b", parentId: "a", qty: 1 }])).toThrow(BoqGroupError);
  });
  it("treats a missing parent as a root", () => {
    expect(effectiveQtyMap([{ id: "a", parentId: "gone", qty: 5 }]).get("a")).toBe(5);
  });
});

describe("wouldCreateCycle", () => {
  const g: GroupNode[] = [{ id: "a", parentId: null, qty: 1 }, { id: "b", parentId: "a", qty: 1 }, { id: "c", parentId: "b", qty: 1 }];
  it("detects loops and self-parenting", () => {
    expect(wouldCreateCycle(g, "a", "c")).toBe(true);
    expect(wouldCreateCycle(g, "a", "a")).toBe(true);
  });
  it("allows valid moves", () => {
    expect(wouldCreateCycle(g, "c", "a")).toBe(false);
    expect(wouldCreateCycle(g, "b", null)).toBe(false);
  });
});

describe("the 0515-1 example from the design discussion", () => {
  const parts = [part("A", "0515-1", { qtyPerAssembly: 2, qty: 8 })];
  it("total part qty = assemblies x per-assembly", () => { expect(groupedPartQty(4, 2)).toBe(8); });
  it("changing the assembly qty 4 -> 6 updates the part to 12", () => {
    expect(planPartQtyUpdates([{ id: "0515-1", parentId: null, qty: 4 }], parts)).toEqual([]);
    expect(planPartQtyUpdates([{ id: "0515-1", parentId: null, qty: 6 }], parts)).toEqual([{ partId: "A", qty: 12 }]);
  });
});

describe("weights", () => {
  it("accessory weight is unit weight x qty; unknown weight adds nothing", () => {
    const withW = computeTakeoffPart({ partType: "ACCESSORY", geometry: { unit: "pcs", unitWeightKg: 0.076 }, qty: 16 });
    expect(withW.weightKg).toBeCloseTo(1.216, 6);
    const noW = computeTakeoffPart({ partType: "ACCESSORY", geometry: { unit: "pcs" }, qty: 16 });
    expect(noW.weightKg).toBe(0);
    expect(noW.totalArea).toBe(0);
    expect(noW.paintAreaSqm).toBe(0);
  });
  it("an accessory never carries scrap", () => {
    const c = computeTakeoffPart({ partType: "ACCESSORY", geometry: { unit: "pcs" }, qty: 1, buyWeightKg: 5 });
    expect(c.buyWeightKg).toBeNull();
    expect(c.scrapKg).toBeNull();
  });
  it("keeps fabricated and purchased weight apart", () => {
    const s = splitWeights([part("1", null, { weightKg: 100 }), part("2", null, { partType: "ACCESSORY", weightKg: 1.216 }), part("3", null, { partType: "ACCESSORY", weightKg: 0 })]);
    expect(s.fabricatedKg).toBe(100);
    expect(s.accessoriesKg).toBeCloseTo(1.216, 6);
    expect(s.totalKg).toBeCloseTo(101.216, 6);
    expect(s.accessoriesWithoutWeight).toBe(1);
  });
  it("a sub-assembly is counted once", () => {
    const groups: GroupNode[] = [{ id: "wall", parentId: null, qty: 2 }, { id: "hatch", parentId: "wall", qty: 1 }];
    const parts = [
      part("p1", "wall", { qty: 2, weightKg: 1000 }),
      part("p2", "hatch", { qty: 2, weightKg: 89.08 }),
      part("bolt", "hatch", { partType: "ACCESSORY", qty: 8, weightKg: 0.608 }),
    ];
    const r = rollupGroups(groups, parts);
    expect(r.get("hatch")!.subtree.totalKg).toBeCloseTo(89.688, 6);
    expect(r.get("wall")!.subtree.totalKg).toBeCloseTo(1089.688, 6);
    expect(r.get("wall")!.perAssembly!.totalKg).toBeCloseTo(544.844, 6);
    expect(splitWeights(parts).totalKg).toBeCloseTo(1089.688, 6);
  });
  it("per-assembly weight is null when qty is 0", () => {
    expect(rollupGroups([{ id: "g", parentId: null, qty: 0 }], [part("x", "g", { weightKg: 10 })]).get("g")!.perAssembly).toBeNull();
  });
});
