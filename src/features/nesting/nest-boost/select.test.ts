import { describe, expect, it } from "vitest";
import {
  bbox, cancelGroupDrag, isBad, itemsInRect, makeSettings, moveGroup, newSheet, nudgeGroup, rotateGroup, separateGroup, setCellCanvasFactory, sides, startGroupDrag, transferGroup,
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

describe("carrying the selection to another sheet", () => {
  it("moves the whole group to the other sheet under the pointer, and Esc brings it home", () => {
    const { sh, A, B } = setup();
    const other = newSheet(10, "S235");
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    ms.carry = true;
    ms.home = { sh, pos: ms.items.map((q) => [q.x, q.y] as Pt) };
    startGroupDrag(ms, S, [250, 125]);
    const dx = B.x - A.x;
    expect(transferGroup(ms, S, other, 1, [500, 300])).toBe(true);
    expect(ms.sh).toBe(other);
    expect(other.items).toEqual(expect.arrayContaining([A, B]));
    expect(sh.items).not.toContain(A);
    expect(sh.items).not.toContain(B);
    expect(B.x - A.x).toBeCloseTo(dx); // still one rigid group
    const bb = bbox(sides(A).o);
    expect(bb[0]).toBeGreaterThanOrEqual(S.mg - 0.01);
    moveGroup(ms, S, 100, 0); // keeps following the mouse on the new sheet
    cancelGroupDrag(ms); // Esc
    expect(ms.sh).toBe(sh);
    expect(sh.items).toEqual(expect.arrayContaining([A, B]));
    expect(other.items).toHaveLength(0);
    expect([A.x, A.y, B.x, B.y]).toEqual([100, 100, 300, 100]);
  });

  it("refuses another material/thickness, and a spot that is already taken", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    expect(transferGroup(ms, S, newSheet(12, "S235"), 1, [500, 300])).toBe(false);
    expect(transferGroup(ms, S, newSheet(10, "st37"), 1, [500, 300])).toBe(false);
    const busy = newSheet(10, "S235");
    busy.items.push({ g: grp(9, 600, 300), rot: 0, x: 200, y: 150 });
    expect(transferGroup(ms, S, busy, 1, [400, 175])).toBe(false);
    expect(ms.sh).toBe(sh); // nothing moved
    expect(sh.items).toEqual(expect.arrayContaining([A, B]));
  });

  it("pulls the group back inside the margin when the pointer enters at the edge", () => {
    const { sh, A, B } = setup();
    const other = newSheet(10, "S235");
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    expect(transferGroup(ms, S, other, 1, [1, 1])).toBe(true);
    const bb = bbox(sides(A).o);
    expect(bb[0]).toBeGreaterThanOrEqual(S.mg - 0.01);
    expect(bb[1]).toBeGreaterThanOrEqual(S.mg - 0.01);
  });
});

describe("rotating the selection as a block", () => {
  const corners = (it: Item) => {
    const b = bbox(sides(it).o);
    return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1] };
  };

  it("turns the whole block 90° rigidly: sizes swap, distances between parts are kept", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    const a0 = corners(A);
    const b0 = corners(B);
    const dist0 = Math.hypot(b0.cx - a0.cx, b0.cy - a0.cy);
    startGroupDrag(ms, S, [0, 0]);
    rotateGroup(ms, S, 90);
    const a1 = corners(A);
    const b1 = corners(B);
    expect(A.rot).toBe(90);
    expect(B.rot).toBe(90);
    expect([a1.w, a1.h]).toEqual([a0.h, a0.w]); // each part turned
    expect(Math.hypot(b1.cx - a1.cx, b1.cy - a1.cy)).toBeCloseTo(dist0, 3); // block is rigid
    // A and B were side by side (horizontal); after 90° they are one above the other
    expect(Math.abs(b1.cx - a1.cx)).toBeLessThan(0.01);
    expect(Math.abs(b1.cy - a1.cy)).toBeCloseTo(200, 3);
  });

  it("four quarter turns bring every part back to where it was", () => {
    const { sh, A, B, C } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B, C] };
    for (const q of [A, B, C]) {
      q.x += 2.5; // parts sit on the optimiser's grid (x0 = 2.5 here)
      q.y += 2.5;
    }
    const before = [A, B, C].map((q) => [q.x, q.y]);
    startGroupDrag(ms, S, [0, 0]);
    for (let i = 0; i < 4; i++) rotateGroup(ms, S, 90);
    [A, B, C].forEach((q, i) => {
      expect(q.rot % 360).toBe(0);
      expect(q.x).toBeCloseTo(before[i][0], 3);
      expect(q.y).toBeCloseTo(before[i][1], 3);
    });
  });

  it("is never blocked: with no room it turns anyway and is flagged bad, then Esc restores it", () => {
    const { sh, A, B } = setup();
    // a wall of other parts right above A and B so a turned block cannot fit
    sh.items.push({ g: grp(8, 400, 40), rot: 0, x: 100, y: 160 });
    sh.items.push({ g: grp(9, 400, 40), rot: 0, x: 100, y: 40 });
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    ms.carry = true;
    ms.home = { sh, pos: ms.items.map((q) => [q.x, q.y] as Pt), rot: ms.items.map((q) => q.rot) };
    startGroupDrag(ms, S, [0, 0]);
    rotateGroup(ms, S, 90);
    expect(A.rot).toBe(90);
    expect(ms.drag?.bad).toBe(true);
    cancelGroupDrag(ms);
    expect([A.rot, B.rot]).toEqual([0, 0]);
    expect([A.x, A.y, B.x, B.y]).toEqual([100, 100, 300, 100]);
  });

  it("keeps the block on the optimiser's grid", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    rotateGroup(ms, S, 90);
    for (const q of [A, B]) {
      expect(((q.x - S.x0) / S.cell) % 1).toBeCloseTo(0, 6);
      expect(((q.y - S.x0) / S.cell) % 1).toBeCloseTo(0, 6);
    }
  });
});

describe("free-angle block rotation", () => {
  it("rotating by 35° keeps the distance between parts (rigid), and -35° undoes it", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [0, 0]);
    rotateGroup(ms, S, 35);
    expect(A.rot).toBe(35);
    expect(B.rot).toBe(35);
    const rel = (it: Item) => {
      const b = bbox(sides(it).o);
      return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    };
    const d35 = Math.hypot(rel(B)[0] - rel(A)[0], rel(B)[1] - rel(A)[1]);
    expect(d35).toBeCloseTo(200, 0); // same-size parts: bbox centres are also fixed points
    rotateGroup(ms, S, -35);
    expect(((A.rot % 360) + 360) % 360).toBe(0);
    expect(rel(B)[0] - rel(A)[0]).toBeCloseTo(200, 0);
  });
});

describe("separating a moved group (S key)", () => {
  it("mouse drag: the part under the pointer stays in hand, the other goes back to where it was", () => {
    const { sh, A, B } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A, B] };
    startGroupDrag(ms, S, [150, 125]); // pointer on A
    moveGroup(ms, S, 0, 100); // both moved up by 100
    expect(A.y).toBe(200);
    expect(B.y).toBe(200);
    expect(separateGroup(ms, S)).toBe(A);
    expect([B.x, B.y]).toEqual([300, 100]); // last position
    expect(ms.items).toEqual([A]);
    moveGroup(ms, S, 50, 0); // A keeps following the pointer, B stays put
    expect([A.x, A.y]).toEqual([150, 200]);
    expect([B.x, B.y]).toEqual([300, 100]);
  });

  it("carry: the others return to the pick-up spot on the home sheet, even from another sheet", () => {
    const { sh, A, B } = setup();
    const other = newSheet(10, "S235");
    const ms: MultiSel = { sh, idx: 0, items: [A, B], carry: true, home: { sh, pos: [[A.x, A.y], [B.x, B.y]], rot: [0, 0] } };
    startGroupDrag(ms, S, [350, 125]); // pointer on B
    expect(transferGroup(ms, S, other, 1, [500, 250])).toBe(true);
    expect(other.items).toHaveLength(2);
    const kept = separateGroup(ms, S) as Item; // pointer sits between them after the jump: whichever is nearer stays
    const back = kept === A ? B : A;
    const home = back === A ? [100, 100] : [300, 100];
    expect(sh.items).toContain(back);
    expect([back.x, back.y]).toEqual(home);
    expect(other.items).toEqual([kept]); // the kept part stays in hand on the sheet it is over
    cancelGroupDrag(ms); // Esc later brings it back to its own last position
    expect(sh.items).toContain(kept);
    expect([kept.x, kept.y]).toEqual(kept === A ? [100, 100] : [300, 100]);
  });

  it("does nothing for a single part", () => {
    const { sh, A } = setup();
    const ms: MultiSel = { sh, idx: 0, items: [A] };
    startGroupDrag(ms, S, [150, 125]);
    expect(separateGroup(ms, S)).toBeNull();
  });
});