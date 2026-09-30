import { describe, expect, it } from "vitest";
import {
  bbox, inGhost, leftOf, makeSettings, moveTo, newSheet, placedCounts, sides, startNew, syncUnplaced, transfer,
  type Group, type OptResult, type Pt,
} from "./engine";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const grp = (id: number, qty: number, w = 100, h = 50): Group => ({
  id, sn: id + 1, name: `p${id}`, qty, th: 10, material: "S235", outer: rect(w, h), holes: [], w, h, area: w * h, per: 2 * (w + h),
});
const S = makeSettings({ W: 1000, H: 500, mg: 5, gp: 5, cell: 5, ro: 2 });

/** Drops a fresh copy of g on sheet 0 at (x,y) the same way the UI does. */
function dropAt(res: OptResult, g: Group, x: number, y: number) {
  const sel = startNew(g);
  expect(inGhost(sel)).toBe(true);
  expect(transfer(sel, S, res.sheets[0], 0, [x, y])).toBe(true);
  moveTo(sel, S, x - sel.off[0], y - sel.off[1]);
  return sel;
}

describe("manual nesting", () => {
  it("counts placed pieces and refuses when the quantity is used up", () => {
    const g = grp(0, 2);
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    expect(leftOf(g, placedCounts(res))).toBe(2);
    dropAt(res, g, 100, 100);
    expect(leftOf(g, placedCounts(res))).toBe(1);
    dropAt(res, g, 400, 100);
    expect(leftOf(g, placedCounts(res))).toBe(0); // 0 left -> UI button disabled / toast
    syncUnplaced(res, [g]);
    expect(res.un).toHaveLength(0);
  });

  it("frees the piece again when it is taken off the sheet", () => {
    const g = grp(0, 1);
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    const sel = dropAt(res, g, 100, 100);
    expect(leftOf(g, placedCounts(res))).toBe(0);
    res.sheets[0].items.splice(res.sheets[0].items.indexOf(sel.it), 1); // what removeHeld does
    expect(leftOf(g, placedCounts(res))).toBe(1);
    syncUnplaced(res, [g]);
    expect(res.un).toHaveLength(1);
  });

  it("does not enter a sheet of another thickness/material", () => {
    const g = { ...grp(0, 1), th: 12 };
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    expect(transfer(startNew(g), S, res.sheets[0], 0, [100, 100])).toBe(false);
  });

  it("cannot be dropped overlapping another part or inside the margin", () => {
    const g = grp(0, 3);
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    dropAt(res, g, 300, 200);
    // land right on top of the first one: transfer must refuse (overlap)
    expect(transfer(startNew(g), S, res.sheets[0], 0, [300, 200])).toBe(false);
    // held at the very corner: bounding box would enter the margin
    expect(transfer(startNew(g), S, res.sheets[0], 0, [0, 0])).toBe(false);
    const ok = dropAt(res, g, 600, 300);
    const b = bbox(sides(ok.it).o);
    expect(b[0]).toBeGreaterThanOrEqual(S.mg - 0.01);
  });
});
