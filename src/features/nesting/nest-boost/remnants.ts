// Finds the usable rectangular remnants left on a nested sheet: the biggest empty rectangles around the parts.
//
// The sheet is rasterised; a cell is "taken" when a part (grown by the spacing) touches it, so a remnant never
// overlaps a part. The edge margin is treated as unusable too, which keeps every remnant a conservative, safe size.
import { bbox, mgOf, sides, type Pt, type Settings, type Sheet } from "./engine";

export interface Remnant { x: number; y: number; w: number; h: number; area: number }
export interface RemnantOptions {
  /** Smallest side worth keeping, mm */
  minSide: number;
  /** Smallest area worth keeping, mm² */
  minArea: number;
  /** At most this many per sheet */
  max: number;
}
export const DEFAULT_REMNANT_OPTIONS: RemnantOptions = { minSide: 300, minArea: 300 * 300, max: 3 };

function inside(poly: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Largest all-free rectangle in a boolean grid (rows of cells), as [col, row, cols, rows]. */
function largestFree(taken: Uint8Array, cols: number, rows: number): [number, number, number, number] | null {
  const h = new Int32Array(cols);
  let best: [number, number, number, number] | null = null;
  let bestArea = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) h[c] = taken[r * cols + c] ? 0 : h[c] + 1;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const cur = c === cols ? 0 : h[c];
      while (stack.length && h[stack[stack.length - 1]] >= cur) {
        const height = h[stack.pop()!];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        if (height * width > bestArea) { bestArea = height * width; best = [left, r - height + 1, width, height]; }
      }
      stack.push(c);
    }
  }
  return best;
}

export function findRemnants(sheet: Sheet, S: Settings, opts: RemnantOptions = DEFAULT_REMNANT_OPTIONS): Remnant[] {
  const W = sheet.W ?? sheet.stockW ?? S.W;
  const H = sheet.H ?? sheet.stockH ?? S.H;
  const mg = mgOf(sheet, S);
  const gap = Math.max(0, S.gp);
  const c = Math.max(5, Math.ceil(Math.max(W, H) / 500));
  const cols = Math.floor(W / c), rows = Math.floor(H / c);
  if (cols < 2 || rows < 2) return [];
  const taken = new Uint8Array(cols * rows);

  // the edge margin
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x0 = k * c, y0 = r * c;
    if (x0 < mg || y0 < mg || x0 + c > W - mg || y0 + c > H - mg) taken[r * cols + k] = 1;
  }

  const mark = (x: number, y: number) => {
    const k0 = Math.floor((x - gap) / c), k1 = Math.floor((x + gap) / c);
    const r0 = Math.floor((y - gap) / c), r1 = Math.floor((y + gap) / c);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) for (let k = Math.max(0, k0); k <= Math.min(cols - 1, k1); k++) taken[r * cols + k] = 1;
  };
  for (const it of sheet.items) {
    const polys = sides(it).o;
    const [x0, y0, x1, y1] = bbox(polys);
    // the outline itself (sampled along every edge), then the inside
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (c / 2)));
        for (let s = 0; s <= n; s++) mark(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n);
      }
      const r0 = Math.max(0, Math.floor(y0 / c)), r1 = Math.min(rows - 1, Math.floor(y1 / c));
      const k0 = Math.max(0, Math.floor(x0 / c)), k1 = Math.min(cols - 1, Math.floor(x1 / c));
      for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) if (inside(poly, (k + 0.5) * c, (r + 0.5) * c)) taken[r * cols + k] = 1;
    }
  }

  const out: Remnant[] = [];
  while (out.length < opts.max) {
    const b = largestFree(taken, cols, rows);
    if (!b) break;
    const [k, r, wc, hc] = b;
    const w = Math.floor((wc * c) / 10) * 10, h = Math.floor((hc * c) / 10) * 10;
    if (Math.min(w, h) < opts.minSide || w * h < opts.minArea) break;
    out.push({ x: k * c, y: r * c, w, h, area: w * h });
    for (let rr = r; rr < r + hc; rr++) for (let kk = k; kk < k + wc; kk++) taken[rr * cols + kk] = 1;
  }
  return out;
}

/** Remnants of every sheet of a nest, grouped by thickness / material / size (one line with a quantity each). */
export function remnantLines(sheets: Sheet[], S: Settings, opts: RemnantOptions = DEFAULT_REMNANT_OPTIONS) {
  const map = new Map<string, { thicknessMm: number; material: string; widthMm: number; heightMm: number; qty: number }>();
  for (const sh of sheets) {
    for (const r of findRemnants(sh, S, opts)) {
      const [a, b] = [r.w, r.h].sort((x, y) => y - x);
      const key = `${sh.th}|${(sh.material ?? "").toUpperCase()}|${a}|${b}`;
      const cur = map.get(key) ?? { thicknessMm: sh.th, material: sh.material ?? "", widthMm: a, heightMm: b, qty: 0 };
      cur.qty++;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((x, y) => x.thicknessMm - y.thicknessMm || y.widthMm * y.heightMm - x.widthMm * x.heightMm);
}
