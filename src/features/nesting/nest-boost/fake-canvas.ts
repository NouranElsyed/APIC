/**
 * Tiny canvas stand-in for unit tests (no DOM in vitest "node" environment).
 * Only supports what the spacing rasteriser uses, for axis-aligned rectangular parts:
 * a pixel is "on" when the part grown by lineWidth/2 overlaps it by a positive area.
 */
export function fakeCanvasFactory(w: number, h: number): HTMLCanvasElement {
  let tf = [1, 0, 0, 1, 0, 0];
  let lw = 0;
  let stroked = false;
  const rings: number[][][] = [];
  const ctx = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => (tf = [a, b, c, d, e, f]),
    beginPath: () => {
      rings.length = 0;
      stroked = false;
    },
    moveTo: (x: number, y: number) => rings.push([[x, y]]),
    lineTo: (x: number, y: number) => rings[rings.length - 1].push([x, y]),
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => (stroked = true),
    set lineWidth(v: number) {
      lw = v;
    },
    set lineJoin(_v: string) {},
    getImageData: () => {
      const pts = rings.flat().map(([x, y]) => [x * tf[0] + tf[4], y * tf[3] + tf[5]]);
      const g = stroked ? (lw / 2) * tf[0] : 0;
      const x0 = Math.min(...pts.map((p) => p[0])) - g;
      const x1 = Math.max(...pts.map((p) => p[0])) + g;
      const y0 = Math.min(...pts.map((p) => p[1])) - g;
      const y1 = Math.max(...pts.map((p) => p[1])) + g;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let r = 0; r < h; r++)
        for (let q = 0; q < w; q++) if (q + 1 > x0 + 1e-9 && q < x1 - 1e-9 && r + 1 > y0 + 1e-9 && r < y1 - 1e-9) data[(r * w + q) * 4 + 3] = 255;
      return { data };
    },
  };
  return { getContext: () => ctx } as unknown as HTMLCanvasElement;
}
