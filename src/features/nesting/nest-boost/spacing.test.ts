import { beforeAll, describe, expect, it } from "vitest";
import {
  bbox, makeSettings, moveTo, newSheet, setCellCanvasFactory, sides, snapV, startNew, transfer,
  type Group, type Item, type Pt, type Sheet,
} from "./engine";
import { fakeCanvasFactory } from "./fake-canvas";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const grp = (id: number, w: number, h: number): Group => ({
  id, sn: id + 1, name: `p${id}`, qty: 9, th: 5, material: "st37", outer: rect(w, h), holes: [], w, h, area: w * h, per: 2 * (w + h),
});
const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 2 });

beforeAll(() => setCellCanvasFactory(fakeCanvasFactory));

/** Puts a part on the sheet by hand at the grid point nearest to (x, y) (bottom-left corner). */
function place(sh: Sheet, g: Group, x: number, y: number): Item | null {
  const sel = startNew(g);
  if (!transfer(sel, S, sh, 0, [x + g.w / 2, y + g.h / 2])) return null;
  moveTo(sel, S, snapV(S, x), snapV(S, y));
  return sel.it;
}

describe("manual spacing = optimiser spacing", () => {
  it("leaves exactly the gap the optimiser leaves (spacing rounded up to the grid), not less", () => {
    const sh = newSheet(5, "st37");
    const g = grp(1, 490, 490); // the size in the screenshot: optimiser pitch 500 mm => 10 mm gap
    const a = place(sh, g, 100, 100) as Item;
    expect(a).not.toBeNull();
    const b = startNew(g);
    expect(transfer(b, S, sh, 0, [1500, 350])).toBe(true);
    for (let i = 1; i <= 80; i++) moveTo(b, S, 1500 - i * 15 - b.off[0], 350 - b.off[1]); // drag it against A
    const ab = bbox(sides(a).o);
    const bb = bbox(sides(b.it).o);
    expect(bb[0] - ab[2]).toBeCloseTo(10);
  });

  it("refuses to drop a part inside the free zone around another part", () => {
    const g = grp(1, 490, 490);
    /** Fresh sheet with A on it, then try to drop B `gap` mm to the right of A; returns the gap it really got (or null). */
    const drop = (gap: number): number | null => {
      const sh = newSheet(5, "st37");
      const a = place(sh, g, 100, 100) as Item;
      const right = bbox(sides(a).o)[2];
      const s = startNew(g);
      if (!transfer(s, S, sh, 0, [right + gap + 245, a.y + 245])) return null;
      return bbox(sides(s.it).o)[0] - right;
    };
    expect(drop(5)).toBeNull(); // the old rule (>= 4.5 mm) allowed this
    expect(drop(2)).toBeNull();
    expect(drop(0)).toBeNull();
    expect(drop(10)).toBeCloseTo(10);
    expect(drop(7.5)).toBeCloseTo(10); // snaps to the grid, so it lands on the first legal spot
  });

  it("parts always sit on the optimiser's grid", () => {
    const sh = newSheet(5, "st37");
    const it = place(sh, grp(1, 490, 490), 333, 217) as Item;
    expect((it.x - S.x0) % S.cell).toBeCloseTo(0);
    expect((it.y - S.x0) % S.cell).toBeCloseTo(0);
  });
});
