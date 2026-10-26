import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bbox, makeSettings, parseSheetSizes, problemMessages, resizeSheet, runOptimize, setCellCanvasFactory, sides, sourcesForLot,
  type Group, type OptResult, type Pt, type SheetSource2D,
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


const opts = (base: OptResult | null, sources: SheetSource2D[], fallbackDefault?: boolean) => ({
  S, pair: false, common: false, timeSec: 0.05, base, sources, fallbackDefault, shouldStop: () => false, onBest: () => {}, onStatus: () => {},
});
const src = (id: number, th: number, W: number, H: number, qty: number | null, material = ""): SheetSource2D => ({ id, th, material, W, H, qty });
const gth = (id: number, th: number, w: number, h: number, qty: number): Group => ({ ...grp(id, w, h, qty), th });

describe("parseSheetSizes", () => {
  it("reads several sizes with optional counts", () => {
    const r = parseSheetSizes("3000x1500, 2400 x 1200 x 2;1250×2500\n6000*1500*3", null);
    expect(r.invalid).toEqual([]);
    expect(r.items).toEqual([
      { W: 3000, H: 1500, qty: null }, { W: 2400, H: 1200, qty: 2 }, { W: 1250, H: 2500, qty: null }, { W: 6000, H: 1500, qty: 3 },
    ]);
  });
  it("uses the default count and reports what it cannot read", () => {
    expect(parseSheetSizes("3000x1500", 4).items).toEqual([{ W: 3000, H: 1500, qty: 4 }]);
    const r = parseSheetSizes("3000x1500, 3000, abc, 0x100, 2000x1000x0", null);
    expect(r.items).toHaveLength(1);
    expect(r.invalid).toEqual(["3000", "abc", "0x100", "2000x1000x0"]);
  });
});

describe("sourcesForLot", () => {
  const list = [src(1, 0, 3000, 1500, null), src(2, 10, 2000, 1000, 2), src(3, 5, 1000, 1000, 1), src(4, 10, 500, 500, 0), src(5, 0, 800, 800, 1, "S355")];
  it("matches thickness and material (0 / blank = any), drops empty ones, limited quantities first", () => {
    expect(sourcesForLot(list, 10, "S355").map((x) => x.id)).toEqual([2, 5, 1]);
    expect(sourcesForLot(list, 10, "st37").map((x) => x.id)).toEqual([2, 1]);
    expect(sourcesForLot(list, 5, "").map((x) => x.id)).toEqual([3, 1]);
    expect(sourcesForLot(list, 3, "").map((x) => x.id)).toEqual([1]);
  });
});

describe("nesting on several sheet sizes", () => {
  it("uses the leftover sheet first, then the default sheet", async () => {
    patchDoc();
    // 6 parts 900x900: the 2000x1000 leftover takes 2, the other 4 go on the default 6000x1500 sheet (6 fit across)
    const r = (await runOptimize([gth(1, 5, 900, 900, 6)], opts(null, [src(7, 5, 2000, 1000, 1)]))) as OptResult;
    expect(r.un).toHaveLength(0);
    const left = r.sheets.filter((s) => s.srcId === 7);
    expect(left).toHaveLength(1);
    expect(left[0].items).toHaveLength(2);
    expect([left[0].W, left[0].H, left[0].stockW, left[0].stockH]).toEqual([2000, 1000, 2000, 1000]);
    const def = r.sheets.filter((s) => s.srcId === undefined);
    expect(def).toHaveLength(1);
    expect(def[0].items).toHaveLength(4);
    expect(def.every((s) => s.W === undefined)).toBe(true);
    expect(r.sheets.flatMap((s) => s.items)).toHaveLength(6);
    for (const it of left[0].items) {
      const b = bbox(sides(it).o);
      expect(b[2]).toBeLessThanOrEqual(2000 - 5 + 0.01);
      expect(b[3]).toBeLessThanOrEqual(1000 - 5 + 0.01);
    }
  });

  it("a different sheet size per thickness; trimming a sheet never goes past its own stock size", async () => {
    patchDoc();
    const r = (await runOptimize(
      [gth(1, 5, 900, 900, 2), gth(2, 10, 700, 700, 2)],
      opts(null, [src(1, 5, 2000, 1000, null), src(2, 10, 1500, 1500, null)]),
    )) as OptResult;
    const t5 = r.sheets.filter((s) => s.th === 5);
    const t10 = r.sheets.filter((s) => s.th === 10);
    expect(t5.every((s) => s.W === 2000 && s.H === 1000)).toBe(true);
    expect(t10.every((s) => s.W === 1500 && s.H === 1500)).toBe(true);
    expect(t5.flatMap((s) => s.items)).toHaveLength(2);
    expect(t10.flatMap((s) => s.items)).toHaveLength(2);
    // default sheet is 6000 x 1500, yet a 1500 x 1500 sheet cannot be "trimmed" up to 6000
    const out = resizeSheet(t10[0], S, 5000, 5000);
    expect(out).toEqual({ w: 1500, h: 1500 });
  });

  it("a part too big for the source goes on the default sheet; without the fallback it is reported", async () => {
    patchDoc();
    const big = gth(1, 5, 2500, 900, 1); // 2000x1000 source is too small, 6000x1500 default fits
    const a = (await runOptimize([big], opts(null, [src(1, 5, 2000, 1000, null)]))) as OptResult;
    expect(a.un).toHaveLength(0);
    expect(a.sheets[0].srcId).toBeUndefined();
    const b = (await runOptimize([big], opts(null, [src(1, 5, 2000, 1000, null)], false))) as OptResult;
    expect(b.sheets).toHaveLength(0);
    expect(b.un).toHaveLength(1);
    expect(problemMessages(b, S).join()).toMatch(/larger than the usable sheet area/);
  });

  it("when the sheets you have are used up and the default is not allowed, the part says so", async () => {
    patchDoc();
    const r = (await runOptimize([gth(1, 5, 900, 900, 4)], opts(null, [src(1, 5, 2000, 1000, 1)], false))) as OptResult;
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].items).toHaveLength(2);
    expect(r.un).toHaveLength(2);
    expect(problemMessages(r, S).join()).toMatch(/used up/);
  });

  it("a lot with no matching source is nested on the default sheet as before", async () => {
    patchDoc();
    const r = (await runOptimize([gth(1, 8, 900, 900, 2)], opts(null, [src(1, 5, 2000, 1000, null)]))) as OptResult;
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].W).toBeUndefined();
    expect(r.sheets[0].srcId).toBeUndefined();
  });

  it("continuing a nest counts the sheets already cut from a limited source", async () => {
    patchDoc();
    const sources = [src(7, 5, 2000, 1000, 1)];
    const r1 = (await runOptimize([gth(1, 5, 900, 900, 2)], opts(null, sources))) as OptResult;
    expect(r1.sheets.filter((s) => s.srcId === 7)).toHaveLength(1);
    const r2 = (await runOptimize([gth(1, 5, 900, 900, 4)], opts(r1, sources))) as OptResult; // 2 more pieces
    expect(r2.un).toHaveLength(0);
    expect(r2.sheets.filter((s) => s.srcId === 7)).toHaveLength(1); // the one leftover sheet is not used twice
    expect(r2.sheets.filter((s) => s.srcId === undefined).length).toBeGreaterThan(0);
    expect(r2.sheets.flatMap((s) => s.items)).toHaveLength(4);
  });

  it("a full-size part gets the leftover sheet of exactly its size, with no margin", async () => {
    patchDoc();
    const r = (await runOptimize([gth(1, 5, 2000, 1000, 1)], opts(null, [src(3, 5, 2000, 1000, 1)]))) as OptResult;
    expect(r.un).toHaveLength(0);
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].solo).toBe(true);
    expect(r.sheets[0].srcId).toBe(3);
    expect(r.sheets[0].items[0].x).toBe(0);
  });
});
