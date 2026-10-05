import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bbox, makeSettings, placedCounts, runOptimize, sameSheetSettings, setCellCanvasFactory, sides,
  type Group, type OptResult, type Pt,
} from "./engine";
import { fakeCanvasFactory } from "./fake-canvas";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const grp = (id: number, w: number, h: number, qty: number): Group => ({
  id, sn: id, name: `p${id}`, qty, th: 5, material: "st37", outer: rect(w, h), holes: [], w, h, area: w * h, per: 2 * (w + h),
});
const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 });

// the optimiser rasterises with real Path2D / canvas; stand-ins good enough for axis-aligned rectangles
class FakePath2D {
  rings: number[][][] = [];
  moveTo(x: number, y: number) { this.rings.push([[x, y]]); }
  lineTo(x: number, y: number) { this.rings[this.rings.length - 1].push([x, y]); }
  closePath() {}
}
function pathCanvas(w: number, h: number) {
  let tf = [1, 0, 0, 1, 0, 0];
  let lw = 0;
  let stroked = false;
  let P: FakePath2D | null = null;
  const ctx = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => (tf = [a, b, c, d, e, f]),
    fill: (p: FakePath2D) => { P = p; },
    stroke: () => { stroked = true; },
    set lineWidth(v: number) { lw = v; },
    set lineJoin(_v: string) {},
    getImageData: () => {
      const pts = (P as FakePath2D).rings.flat().map(([x, y]) => [x * tf[0] + tf[4], y * tf[3] + tf[5]]);
      const g = stroked ? (lw / 2) * tf[0] : 0;
      const x0 = Math.min(...pts.map((p) => p[0])) - g, x1 = Math.max(...pts.map((p) => p[0])) + g;
      const y0 = Math.min(...pts.map((p) => p[1])) - g, y1 = Math.max(...pts.map((p) => p[1])) + g;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let r = 0; r < h; r++)
        for (let q = 0; q < w; q++) if (q + 1 > x0 + 1e-9 && q < x1 - 1e-9 && r + 1 > y0 + 1e-9 && r < y1 - 1e-9) data[(r * w + q) * 4 + 3] = 255;
      return { data };
    },
  };
  return { width: w, height: h, getContext: () => ctx };
}

beforeAll(() => {
  setCellCanvasFactory(fakeCanvasFactory);
  const g = globalThis as Record<string, unknown>;
  g.Path2D = FakePath2D;
  g.document = { createElement: () => pathCanvas(0, 0) };
});
afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.Path2D;
  delete g.document;
});

// document.createElement("canvas") sets width/height after creation, so the stand-in reads them lazily
const patchDoc = () => {
  (globalThis as Record<string, unknown>).document = {
    createElement: () => {
      const cv = { width: 0, height: 0 } as { width: number; height: number; getContext?: () => unknown };
      cv.getContext = () => (pathCanvas(cv.width, cv.height) as { getContext: () => unknown }).getContext();
      return cv;
    },
  };
};

const opts = (base: OptResult | null) => ({
  S, pair: false, common: false, timeSec: 0.05, base, shouldStop: () => false, onBest: () => {}, onStatus: () => {},
});

describe("continuing a nest with the next part", () => {
  it("fills the free space of the previous sheet before opening a new one", async () => {
    patchDoc();
    const A = grp(1, 1000, 1000, 2);
    const B = grp(2, 500, 500, 3);
    const r1 = (await runOptimize([A], opts(null))) as OptResult;
    expect(r1.sheets).toHaveLength(1);
    expect(r1.sheets[0].items).toHaveLength(2);
    const before = r1.sheets[0].items.length;

    const r2 = (await runOptimize([B], opts(r1))) as OptResult;
    expect(r2.sheets).toHaveLength(1); // B went into the free space of sheet 1
    expect(r2.sheets[0].items).toHaveLength(5);
    expect(r1.sheets[0].items).toHaveLength(before); // the earlier result is not touched
    expect([...placedCounts(r2).entries()].sort()).toEqual([[1, 2], [2, 3]]);

    // nothing overlaps and every part stays inside the margin
    const bbs = r2.sheets[0].items.map((x) => bbox(sides(x).o));
    bbs.forEach((b, i) => {
      expect(b[0]).toBeGreaterThanOrEqual(S.mg - 0.01);
      expect(b[1]).toBeGreaterThanOrEqual(S.mg - 0.01);
      expect(b[2]).toBeLessThanOrEqual(S.W - S.mg + 0.01);
      expect(b[3]).toBeLessThanOrEqual(S.H - S.mg + 0.01);
      for (let j = i + 1; j < bbs.length; j++) {
        const c = bbs[j];
        const apart = b[2] <= c[0] + 0.01 || c[2] <= b[0] + 0.01 || b[3] <= c[1] + 0.01 || c[3] <= b[1] + 0.01;
        expect(apart).toBe(true);
      }
    });
  });

  it("opens a new sheet only when the previous one is full, and nests just what is left of a part", async () => {
    patchDoc();
    const A = grp(1, 2900, 1400, 2); // two of these fill a 6000 mm sheet
    const B = grp(2, 2900, 1400, 1);
    const r1 = (await runOptimize([A], opts(null))) as OptResult;
    expect(r1.sheets).toHaveLength(1);
    const r2 = (await runOptimize([B], opts(r1))) as OptResult;
    expect(r2.sheets).toHaveLength(2);
    expect(r2.sheets[0].items).toHaveLength(2);
    expect(r2.sheets[1].items).toHaveLength(1);
    // asking for the same part again: all its pieces are already placed
    expect(await runOptimize([B], opts(r2))).toBeNull();
    // quantity raised afterwards: only the extra piece is added
    const B2 = { ...B, qty: 2 };
    const r3 = (await runOptimize([B2], opts(r2))) as OptResult;
    expect(placedCounts(r3).get(2)).toBe(2);
    expect(r3.sheets).toHaveLength(2);
  });

  it("only continues on sheets of the same thickness / material, and detects different sheet settings", async () => {
    patchDoc();
    const A = grp(1, 1000, 1000, 1);
    const B = { ...grp(2, 500, 500, 1), th: 8 };
    const r1 = (await runOptimize([A], opts(null))) as OptResult;
    const r2 = (await runOptimize([B], opts(r1))) as OptResult;
    expect(r2.sheets).toHaveLength(2);
    expect(r2.sheets.map((x) => x.th)).toEqual([5, 8]);
    expect(sameSheetSettings(S, makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 2 }))).toBe(true);
    expect(sameSheetSettings(S, makeSettings({ W: 6000, H: 1500, mg: 5, gp: 0, cell: 5, ro: 0 }))).toBe(false);
  });
});