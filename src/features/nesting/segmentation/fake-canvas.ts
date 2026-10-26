/**
 * Test helper: lets the nesting engine run under vitest (node) by standing in for the canvas.
 * Parts are rasterised as their bounding boxes (exact for rectangles, pessimistic for other shapes),
 * with the spacing applied as a stroke — the same stand-in the existing engine tests use.
 * Not used by the app.
 */
import { setCellCanvasFactory } from "../nest-boost/engine";
import { fakeCanvasFactory } from "../nest-boost/fake-canvas";

class FakePath2D {
  rings: number[][][] = [];
  moveTo(x: number, y: number) {
    this.rings.push([[x, y]]);
  }
  lineTo(x: number, y: number) {
    this.rings[this.rings.length - 1].push([x, y]);
  }
  closePath() {}
}

function pathCanvas(w: number, h: number) {
  let tf = [1, 0, 0, 1, 0, 0];
  let lw = 0;
  let stroked = false;
  let P: FakePath2D | null = null;
  const ctx = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => (tf = [a, b, c, d, e, f]),
    fill: (p: FakePath2D) => {
      P = p;
    },
    stroke: () => {
      stroked = true;
    },
    set lineWidth(v: number) {
      lw = v;
    },
    set lineJoin(_v: string) {},
    getImageData: () => {
      const pts = (P as FakePath2D).rings.flat().map(([x, y]) => [x * tf[0] + tf[4], y * tf[3] + tf[5]]);
      const g = stroked ? (lw / 2) * tf[0] : 0;
      const x0 = Math.min(...pts.map((p) => p[0])) - g;
      const x1 = Math.max(...pts.map((p) => p[0])) + g;
      const y0 = Math.min(...pts.map((p) => p[1])) - g;
      const y1 = Math.max(...pts.map((p) => p[1])) + g;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let r = 0; r < h; r++) {
        for (let q = 0; q < w; q++) if (q + 1 > x0 + 1e-9 && q < x1 - 1e-9 && r + 1 > y0 + 1e-9 && r < y1 - 1e-9) data[(r * w + q) * 4 + 3] = 255;
      }
      return { data };
    },
  };
  return { width: w, height: h, getContext: () => ctx };
}

export function installFakeCanvas() {
  setCellCanvasFactory(fakeCanvasFactory);
  const g = globalThis as Record<string, unknown>;
  g.Path2D = FakePath2D;
  g.document = {
    createElement: () => {
      const cv = { width: 0, height: 0 } as { width: number; height: number; getContext?: () => unknown };
      cv.getContext = () => (pathCanvas(cv.width, cv.height) as { getContext: () => unknown }).getContext();
      return cv;
    },
  };
}

export function removeFakeCanvas() {
  const g = globalThis as Record<string, unknown>;
  delete g.Path2D;
  delete g.document;
}
