import { beforeAll, describe, expect, it } from "vitest";
import {
  bbox, makeSettings, moveTo, newSheet, regap, setCellCanvasFactory, sides, snapV, startNew, transfer,
  type Group, type Item, type OptResult, type Pt, type Sheet,
} from "./engine";
import { fakeCanvasFactory } from "./fake-canvas";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const grp = (id: number, w: number, h: number): Group => ({
  id, sn: id + 1, name: `p${id}`, qty: 9, th: 5, material: "st37", outer: rect(w, h), holes: [], w, h, area: w * h, per: 2 * (w + h),
});
const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 2 });

beforeAll(() => setCellCanvasFactory(fakeCanvasFactory));

function place(sh: Sheet, g: Group, x: number, y: number): Item {
  const sel = startNew(g);
  expect(transfer(sel, S, sh, 0, [x + g.w / 2, y + g.h / 2])).toBe(true);
  moveTo(sel, S, snapV(S, x), snapV(S, y));
  return sel.it;
}

describe("regap (manual nesting gaps)", () => {
  it("accepts bigger gaps when the placed parts are far enough apart, and the new gap is then enforced", () => {
    const sh = newSheet(5, "st37");
    place(sh, grp(1, 300, 300), 100, 100);
    place(sh, grp(2, 300, 300), 600, 100);
    const res: OptResult = { sheets: [sh], un: [], skip: [], manual: true };
    const out = regap(res, S, 20, 30);
    expect("S" in out).toBe(true);
    if ("S" in out) {
      expect(out.S.mg).toBe(20);
      expect(out.S.gp).toBe(30);
      const sel = startNew(grp(3, 300, 300));
      const first = sh.items[0];
      const right = bbox(sides(first).o)[2];
      // a drop closer than the new gap is refused
      expect(transfer(sel, out.S, sh, 0, [right + 10 + 150, first.y + 150])).toBe(false);
    }
  });

  it("refuses (and restores positions) when parts would break the new gap", () => {
    const sh = newSheet(5, "st37");
    const a = place(sh, grp(1, 300, 300), 100, 100);
    const b = place(sh, grp(2, 300, 300), 410, 100); // ~10 mm apart
    const before = [a.x, a.y, b.x, b.y];
    const res: OptResult = { sheets: [sh], un: [], skip: [], manual: true };
    const out = regap(res, S, 5, 50);
    expect("bad" in out && out.bad > 0).toBe(true);
    expect([a.x, a.y, b.x, b.y]).toEqual(before);
  });

  it("refuses a margin that a placed part already violates", () => {
    const sh = newSheet(5, "st37");
    place(sh, grp(1, 300, 300), 20, 20);
    const res: OptResult = { sheets: [sh], un: [], skip: [], manual: true };
    const out = regap(res, S, 50, 5);
    expect("bad" in out).toBe(true);
  });
});
