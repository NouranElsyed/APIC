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

import { buildDxf, makeSettings, parseDXF, splitNestLoops, type Sheet } from "./engine";

describe("exported nest DXF carries a note per sheet", () => {
  it("writes material, thickness, size and parts above every sheet, and still re-imports", () => {
    const S = makeSettings({ W: 2000, H: 1000, mg: 5, gp: 5, cell: 5, ro: 2 });
    const g: Group = { id: 0, sn: 3, name: "p", qty: 2, th: 8, material: "S235", outer: rect(100, 50), holes: [], w: 100, h: 50, area: 5000, per: 300 };
    const sheets: Sheet[] = [{ items: [{ g, rot: 0, x: 10, y: 10 }, { g, rot: 0, x: 200, y: 10 }], th: 8, material: "S235", used: 0 }];
    const dxf = buildDxf(sheets, S);
    expect(dxf).toContain("Sheet 1 | Material: S235 | thk: 8 mm | 2000 x 1000 | 2 pcs");
    expect(dxf).toContain("#3 x2");
    const r = parseDXF(dxf);
    expect(r.labels.some((l) => l.th === 8)).toBe(true);
    expect(splitNestLoops(r.loops, 1).sheets).toHaveLength(1);
  });
});
