import { describe, expect, it } from "vitest";
import {
  bbox, cancelGroupDrag, isBad, itemsInRect, makeSettings, moveGroup, newSheet, nudgeGroup, setCellCanvasFactory, sides, startGroupDrag,
  type Group, type Item, type MultiSel, type Pt,
} from "./engine";
import { fakeCanvasFactory } from "./fake-canvas";

setCellCanvasFactory(fakeCanvasFactory);

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const grp = (id: number, w = 100, h = 50): Group => ({
  id, sn: id + 1, name: `p${id}`, qty: 9, th: 10, material: "S235", outer: rect(w, h), holes: [], w, h, area: w * h, per: 2 * (w + h),
});
const S = makeSettings({ W: 1000, H: 500, mg: 5, gp: 5, cell: 5, ro: 2 });

function setup() {
  const sh = newSheet(10, "S235");
  const mk = (id: number, x: number, y: number, w = 100, h = 50): Item => {
    const it: Item = { g: grp(id, w, h), rot: 0, x, y };
    sh.items.push(it);
    return it;
  };
  // A: x 100..200, B: x 300..400, C: x 700..800 (all y 100..150)
  return { sh, A: mk(0, 100, 100), B: mk(1, 300, 100), C: mk(2, 700, 100), mk };
}

describe("box selection", () => {
  it("window (left → right) takes only parts completely inside", () => {
    const { sh, A, B } = setup();
    // box x 50..350 covers A entirely and only the left half of B
    const got = itemsInRect(sh, [50, 50, 350, 200], false);
    expect(got).toEqual([A]);
    expect(got).not.toContain(B);
  });

  it("crossing (right → left) takes every part the box touches", () => {
    const { sh, A, B, C } = setup();
    const got = itemsInRect(sh, [350, 200, 50, 50], true);
    expect(got).toContain(A);
    expect(got).toContain(B);
    expect(got).not.toContain(C);
  });

  it("crossing selects a part even when the box sits inside it; window does not", () => {
    const { sh, A } = setup();
    const inner: [number, number, number, number] = [130, 110, 160, 140];
    expect(itemsInRect(sh, inner, true)).toEqual([A]);
    expect(itemsInRect(sh, inner, false)).toEqual([]);
  });

  it("crossing ignores a box that only lies inside a hole", () => {
    const sh = newSheet(10, "S235");
    const g: Group = { ...grp(0, 200, 200), holes: [[[50, 50], [150, 50], [150, 150], [50, 150]]] };
    sh.items.push({ g, rot: 0, x: 100, y: 100 });
    expect(itemsInRect(sh, [190, 190, 210, 210], true)).toEqual([]); // completely inside the hole
    expect(itemsInRect(sh, [110, 110, 130, 130], true)).toHaveLength(1); // on solid material
  });
});

describe("moving the selection together", () => {
  it("keeps relative positions and stops before hitting another part", () => {
    const { sh, A, B, C } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    const dxBefore = B.x - A.x;
    moveGroup(ms, S, 0, 100); // straight up, free space
    expect(A.y).toBeCloseTo(200);
    expect(B.y).toBeCloseTo(200);
    expect(B.x - A.x).toBeCloseTo(dxBefore);
    moveGroup(ms, S, 500, 0); // back to the original row and far right: B would run into C (x 700) -> stops with the spacing left
    const gap = C.x - (B.x + 100);
    expect(gap).toBeGreaterThanOrEqual(S.gp); // never closer than the spacing
    expect(gap).toBeCloseTo(S.gp + S.cell); // same gap the optimiser leaves (spacing rounded up to the grid)
    expect(B.x - A.x).toBeCloseTo(dxBefore);
    for (const it of [A, B, C]) {
      const b = bbox(sides(it).o);
      expect(b[0]).toBeGreaterThanOrEqual(S.mg - 0.01);
    }
  });

  it("never leaves the margin, and Esc restores the start", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    moveGroup(ms, S, -900, -900);
    expect(bbox(sides(A).o)[0]).toBeGreaterThanOrEqual(S.mg - 0.01);
    expect(bbox(sides(A).o)[1]).toBeGreaterThanOrEqual(S.mg - 0.01);
    cancelGroupDrag(ms);
    expect([A.x, A.y, B.x, B.y]).toEqual([100, 100, 300, 100]);
    expect(ms.drag).toBeUndefined();
  });

  it("arrow-key nudge moves the group by the step and respects the walls", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    nudgeGroup(ms, S, 10, 0);
    expect([A.x, B.x]).toEqual([110, 310]);
    nudgeGroup(ms, S, 0, -5000);
    expect(bbox(sides(A).o)[1]).toBeGreaterThanOrEqual(S.mg - 0.01);
  });

  it("a selected part can pass through space only it occupied (its own siblings never block it)", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    moveGroup(ms, S, 0, 50);
    // the moved parts are all valid against the untouched ones
    const others = sh.items.filter((i) => !ms.items.includes(i));
    expect(others).toHaveLength(1);
    expect(isBad({ sh, origSh: sh, idx: 0, it: A, oth: others.map((o) => ({ s: sides(o), bb: bbox(sides(o).o), it: o })), off: [0, 0], pm: [0, 0], orig: { x: 0, y: 0, rot: 0 } }, S)).toBe(false);
  });
});
