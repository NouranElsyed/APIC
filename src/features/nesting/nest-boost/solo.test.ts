import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bbox, canContinueOn, makeSettings, mgOf, placedCounts, runOptimize, sameSheetSettings, setCellCanvasFactory, sides,
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

describe("a part as big as the sheet gets its own sheet with no margin", () => {
  it("places a full-size part alone at 0,0 and keeps the margin for normal parts", async () => {
    patchDoc();
    const full = grp(1, 6000, 1500, 1); // exactly the raw sheet: does not fit inside the 5 mm margins
    const small = grp(2, 500, 500, 3);
    const r = (await runOptimize([full, small], opts(null))) as OptResult;
    expect(r.un).toHaveLength(0);
    const solo = r.sheets.filter((s) => s.solo);
    expect(solo).toHaveLength(1);
    expect(solo[0].items).toHaveLength(1);
    expect(solo[0].items[0].x).toBe(0);
    expect(solo[0].items[0].y).toBe(0);
    expect(mgOf(solo[0], S)).toBe(0);
    const normal = r.sheets.filter((s) => !s.solo);
    expect(normal).toHaveLength(1);
    expect(normal[0].items).toHaveLength(3);
    expect(mgOf(normal[0], S)).toBe(5);
    for (const it of normal[0].items) {
      const b = bbox(sides(it).o);
      expect(b[0]).toBeGreaterThanOrEqual(5 - 0.01);
      expect(b[1]).toBeGreaterThanOrEqual(5 - 0.01);
    }
  });

  it("a part that fits inside the margins is nested normally (no solo sheet)", async () => {
    patchDoc();
    const r = (await runOptimize([grp(1, 5900, 1400, 1)], opts(null))) as OptResult;
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].solo).toBeUndefined();
  });

  it("a part bigger than the raw sheet is still reported as not nested", async () => {
    patchDoc();
    const r = (await runOptimize([grp(1, 6001, 1500, 1)], opts(null))) as OptResult;
    expect(r.sheets).toHaveLength(0);
    expect(r.un).toHaveLength(1);
  });

  it("continuing a nest never puts new parts onto a solo sheet", async () => {
    patchDoc();
    const r1 = (await runOptimize([grp(1, 6000, 1500, 1)], opts(null))) as OptResult;
    expect(r1.sheets[0].solo).toBe(true);
    const r2 = (await runOptimize([grp(2, 100, 100, 1)], opts(r1))) as OptResult;
    expect(r2.sheets).toHaveLength(2);
    expect(r2.sheets[0].items).toHaveLength(1);
    expect(r2.sheets[1].items).toHaveLength(1);
  });
});
