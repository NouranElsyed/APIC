import { describe, expect, it } from "vitest";
import {
  bbox, detentDelta, fitSheetToParts, inGhost, isDetent, rotateSnap, leftOf, makeSettings, moveTo, newSheet, placedCounts, setCellCanvasFactory, sides, startNew, syncUnplaced, transfer,
  type Group, type OptResult, type Pt,
} from "./engine";
import { fakeCanvasFactory } from "./fake-canvas";
import { canRedo, canUndo, record, redo, resetHistory, undo } from "./history";

setCellCanvasFactory(fakeCanvasFactory);

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

describe("fit sheet to parts by direction", () => {
  const setup = () => {
    const g = grp(0, 1);
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    dropAt(res, g, 100, 100);
    return res.sheets[0];
  };

  it("width only trims W and leaves H", () => {
    const sh = setup();
    const r = fitSheetToParts(sh, S, "width");
    expect(r.h).toBe(S.H);
    expect(r.w).toBeLessThan(S.W);
  });

  it("height only trims H and leaves W", () => {
    const sh = setup();
    const r = fitSheetToParts(sh, S, "height");
    expect(r.w).toBe(S.W);
    expect(r.h).toBeLessThan(S.H);
  });

  it("both trims both, and equals width + height applied in turn", () => {
    const a = setup();
    const both = fitSheetToParts(a, S, "both");
    const b = setup();
    fitSheetToParts(b, S, "width");
    const seq = fitSheetToParts(b, S, "height");
    expect(both).toEqual(seq);
    expect(both.w).toBeLessThan(S.W);
    expect(both.h).toBeLessThan(S.H);
  });
});

describe("undo / redo", () => {
  it("steps back and forward through hand edits", () => {
    const g = grp(0, 2);
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    const h = resetHistory(res);
    expect(canUndo(h)).toBe(false);

    dropAt(res, g, 100, 100);
    expect(record(h, res)).toBe(true);
    dropAt(res, g, 400, 100);
    expect(record(h, res)).toBe(true);
    expect(record(h, res)).toBe(false); // nothing changed
    expect(res.sheets[0].items).toHaveLength(2);

    expect(undo(h, res)).toBe(true);
    expect(res.sheets[0].items).toHaveLength(1);
    expect(undo(h, res)).toBe(true);
    expect(res.sheets[0].items).toHaveLength(0);
    expect(undo(h, res)).toBe(false);

    expect(redo(h, res)).toBe(true);
    expect(redo(h, res)).toBe(true);
    expect(res.sheets[0].items).toHaveLength(2);
    expect(redo(h, res)).toBe(false);
  });

  it("restores sheet size and drops redo after a new edit", () => {
    const g = grp(0, 2);
    const res: OptResult = { sheets: [newSheet(10, "S235")], un: [], skip: [], manual: true };
    dropAt(res, g, 100, 100);
    const h = resetHistory(res);
    fitSheetToParts(res.sheets[0], S, "both");
    record(h, res);
    expect(res.sheets[0].W).toBeLessThan(S.W);
    undo(h, res);
    expect(res.sheets[0].W).toBeUndefined();
    dropAt(res, g, 400, 100);
    record(h, res);
    expect(canRedo(h)).toBe(false);
  });
});

describe("rotation detents every 45°", () => {
  it("stops exactly on 45° multiples in both directions", () => {
    expect(detentDelta(40, 5)).toBe(5);
    expect(detentDelta(43, 5)).toBe(2); // would pass 45 -> stops on it
    expect(detentDelta(45, 5)).toBe(5); // on a detent, moves away freely
    expect(detentDelta(88, 5)).toBe(2);
    expect(detentDelta(2, -5)).toBe(-2); // stops on 0
    expect(detentDelta(0, -5)).toBe(-5); // then goes on to 355
    expect(detentDelta(92, -5)).toBe(-2);
    expect(detentDelta(350, 15)).toBe(10); // stops on 360 (= 0)
  });

  it("isDetent recognises 0, 45, 90, 135 ... 360", () => {
    for (const a of [0, 45, 90, 135, 180, 225, 270, 315, 360]) expect(isDetent(a)).toBe(true);
    for (const a of [1, 44.9, 46, 100]) expect(isDetent(a)).toBe(false);
  });

  it("rotateSnap lands on the detent and reports it", () => {
    const sel = startNew(grp(0, 1));
    sel.it.rot = 43;
    expect(rotateSnap(sel, S, 5)).toBe(true);
    expect(sel.it.rot).toBe(45);
    expect(rotateSnap(sel, S, 5)).toBe(false);
    expect(sel.it.rot).toBe(50);
  });
});