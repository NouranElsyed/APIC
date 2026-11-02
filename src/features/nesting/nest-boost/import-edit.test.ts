import { describe, expect, it } from "vitest";
import { addFileParts, mergeDuplicateGroups, type Group, type Pt } from "./engine";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];

describe("editing thickness / material / quantity of imported rows", () => {
  it("folds an edited new row into an existing identical row (quantity adds up)", () => {
    const counters = { id: 0, sn: 0 };
    // the same 100x50 plate imported twice: once as 8 mm S235 (existing), once with no thickness (new)
    let gs = addFileParts([], [rect(100, 50)], "a PL8mm.dxf", 1, counters, { material: "S235", qty: 3 }).groups;
    gs = addFileParts(gs, [rect(100, 50)], "b.dxf", 1, counters, { qty: 2 }).groups;
    expect(gs).toHaveLength(2);
    // the person types 8 mm + S235 for the second one
    const edited = gs.map((g) => (g.id === gs[1].id ? { ...g, th: 8, material: "S235" } : g));
    const m = mergeDuplicateGroups(edited, new Set([gs[1].id]));
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].qty).toBe(5);
    expect(m.merged.get(gs[1].id)).toBe(gs[0].id);
  });

  it("keeps rows apart when thickness or material still differ, or the shape differs", () => {
    const counters = { id: 0, sn: 0 };
    let gs = addFileParts([], [rect(100, 50)], "a.dxf", 1, counters, { th: 8, material: "S235" }).groups;
    gs = addFileParts(gs, [rect(100, 50)], "b.dxf", 1, counters, { th: 10, material: "S235" }).groups;
    gs = addFileParts(gs, [rect(120, 50)], "c.dxf", 1, counters, { th: 8, material: "S235" }).groups;
    expect(gs).toHaveLength(3);
    const edited: Group[] = gs.map((g) => (g.id === gs[2].id ? { ...g, th: 8 } : g));
    expect(mergeDuplicateGroups(edited, new Set(edited.map((g) => g.id))).groups).toHaveLength(3);
  });
});
