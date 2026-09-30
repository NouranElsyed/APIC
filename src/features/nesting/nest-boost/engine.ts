// Nest Boost engine — DXF parsing, part separation and grid-based sheet nesting.
// Pure client-side code (uses Path2D / canvas), no server or database involved.

export type Pt = [number, number];

export interface Group {
  id: number;
  /** Serial number shown next to the part and used in nesting messages. */
  sn: number;
  /** For auto-paired triangles: id of the single-triangle group it came from. */
  cid?: number;
  name: string;
  qty: number;
  /** Plate thickness in mm (0 = unknown). */
  th: number;
  /** Material grade/spec, e.g. "S235", "304 SS" ("" = unknown). Parts only
   *  share a sheet with others of the same thickness AND material. */
  material: string;
  outer: Pt[];
  holes: Pt[][];
  extra?: Pt[][];
  w: number;
  h: number;
  area: number;
  per: number;
  /** Number of physical parts this group represents (2 for a triangle pair). */
  n?: number;
}

export interface Item {
  g: Group;
  /** Rotation in degrees, counter-clockwise, 0 <= rot < 360 (any value, not only multiples of 90). */
  rot: number;
  x: number;
  y: number;
}

export interface Sheet {
  items: Item[];
  th: number;
  material: string;
  used: number;
  grid?: Uint8Array;
  /** Actual physical sheet size, if trimmed down from the stock size (S.W / S.H) to
   *  cut less material / scrap. Undefined = use the stock sheet size. */
  W?: number;
  H?: number;
}

/** The extent (max x, max y) reached by any part currently on the sheet. */
export function sheetExtent(sh: Sheet): { w: number; h: number } {
  let mx = 0;
  let my = 0;
  for (const it of sh.items) {
    const b = bbox(sides(it).o);
    mx = Math.max(mx, b[2]);
    my = Math.max(my, b[3]);
  }
  return { w: mx, h: my };
}

/** Smallest physical size this sheet can be trimmed to without cutting into its parts. */
export function minSheetSize(sh: Sheet, S: Settings): { w: number; h: number } {
  const e = sheetExtent(sh);
  return { w: Math.round(e.w + S.mg), h: Math.round(e.h + S.mg) };
}

/**
 * Trims (or restores) a sheet's physical size, e.g. to cut a shorter/narrower
 * plate for a partly-filled sheet and reduce scrap. Clamped between the
 * minimum needed to hold its parts and the stock sheet size (S.W / S.H).
 * Returns the size actually applied.
 */
export function resizeSheet(sh: Sheet, S: Settings, w: number, h: number): { w: number; h: number } {
  const min = minSheetSize(sh, S);
  const W = Math.min(S.W, Math.max(min.w, Math.round(w)));
  const H = Math.min(S.H, Math.max(min.h, Math.round(h)));
  sh.W = W;
  sh.H = H;
  return { w: W, h: H };
}

export interface Settings {
  W: number;
  H: number;
  mg: number;
  gp: number;
  cell: number;
  ro: number;
  x0: number;
  GW: number;
  GH: number;
}

export interface OptResult {
  sheets: Sheet[];
  un: Group[];
  skip: string[];
  /** True once the user has edited the nest by hand (empty sheets, parts taken from the list / put back).
   *  `un` is then re-derived from the quantities instead of coming from the optimiser. */
  manual?: boolean;
}

const TOL = 0.05;
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- DXF parsing

function arcPts(cx: number, cy: number, r: number, a0: number, sw: number): Pt[] {
  const n = Math.max(3, Math.ceil(Math.abs(sw) / (Math.PI / 36)));
  const p: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sw * i) / n;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

function bulge(p: number[], q: number[], b: number): Pt[] {
  const th = 4 * Math.atan(b);
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const s = (Math.abs(b) * d) / 2;
  const r = (d * d / 4 + s * s) / (2 * s);
  const nx = -(q[1] - p[1]) / d;
  const ny = (q[0] - p[0]) / d;
  const k = (r - s) * Math.sign(b);
  const c: Pt = [(p[0] + q[0]) / 2 + nx * k, (p[1] + q[1]) / 2 + ny * k];
  return arcPts(c[0], c[1], r, Math.atan2(p[1] - c[1], p[0] - c[0]), th).slice(1);
}

function verts2pts(v: number[][], closed: boolean): Pt[] {
  const o: Pt[] = [[v[0][0], v[0][1]]];
  const n = v.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p = v[i];
    const q = v[(i + 1) % n];
    if (p[2]) o.push(...bulge(p, q, p[2]));
    else o.push([q[0], q[1]]);
  }
  return o;
}

interface Ent {
  t: string;
  d: [number, string][];
  v: Ent[];
}

function chain(paths: Pt[][]): Pt[][] {
  const loops: Pt[][] = [];
  while (paths.length) {
    let cur = paths.pop() as Pt[];
    let go = true;
    while (go) {
      go = false;
      if (cur.length > 2 && dist(cur[0], cur[cur.length - 1]) < TOL) break;
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        const a = cur[0];
        const b = cur[cur.length - 1];
        if (dist(b, p[0]) < TOL) cur = cur.concat(p.slice(1));
        else if (dist(b, p[p.length - 1]) < TOL) cur = cur.concat(p.slice(0, -1).reverse());
        else if (dist(a, p[p.length - 1]) < TOL) cur = p.slice(0, -1).concat(cur);
        else if (dist(a, p[0]) < TOL) cur = p.slice(1).reverse().concat(cur);
        else continue;
        paths.splice(i, 1);
        go = true;
        break;
      }
    }
    if (cur.length > 3 && dist(cur[0], cur[cur.length - 1]) < TOL) {
      cur.pop();
      loops.push(cur);
    }
  }
  return loops;
}

export function parseDXF(text: string): { loops: Pt[][]; skip: string[] } {
  const L = text.split(/\r?\n/);
  const E: Ent[] = [];
  let cur: Ent | null = null;
  let ent = false;
  let sec = false;
  let poly: Ent | null = null;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = +L[i].trim();
    const v = L[i + 1].trim();
    if (c === 0) {
      cur = null;
      if (v === "SECTION") sec = true;
      else if (v === "ENDSEC") ent = false;
      else if (ent) {
        if (v === "VERTEX" && poly) {
          cur = { t: "V", d: [], v: [] };
          poly.v.push(cur);
        } else if (v === "SEQEND") poly = null;
        else {
          cur = { t: v, d: [], v: [] };
          E.push(cur);
          if (v === "POLYLINE") poly = cur;
        }
      }
    } else if (c === 2 && sec) {
      ent = v === "ENTITIES";
      sec = false;
    } else if (cur) cur.d.push([c, v]);
  }

  const loops: Pt[][] = [];
  const open: Pt[][] = [];
  const skip: Record<string, number> = {};
  const g = (e: Ent, c: number) => {
    const x = e.d.find((a) => a[0] === c);
    return x ? +x[1] : 0;
  };
  const all = (e: Ent, c: number) => e.d.filter((a) => a[0] === c).map((a) => +a[1]);

  for (const e of E) {
    let p: Pt[] | null = null;
    let cl = false;
    if (e.t === "LINE") p = [[g(e, 10), g(e, 20)], [g(e, 11), g(e, 21)]];
    else if (e.t === "CIRCLE") {
      p = arcPts(g(e, 10), g(e, 20), g(e, 40), 0, 2 * Math.PI);
      p.pop();
      cl = true;
    } else if (e.t === "ARC") {
      const a0 = (g(e, 50) * Math.PI) / 180;
      let a1 = (g(e, 51) * Math.PI) / 180;
      if (a1 <= a0) a1 += 2 * Math.PI;
      p = arcPts(g(e, 10), g(e, 20), g(e, 40), a0, a1 - a0);
    } else if (e.t === "LWPOLYLINE") {
      const v: number[][] = [];
      for (const [c, x] of e.d) {
        if (c === 10) v.push([+x, 0, 0]);
        else if (c === 20 && v.length) v[v.length - 1][1] = +x;
        else if (c === 42 && v.length) v[v.length - 1][2] = +x;
      }
      if (v.length > 1) {
        cl = (g(e, 70) & 1) === 1;
        p = verts2pts(v, cl);
        if (cl) p.pop();
      }
    } else if (e.t === "POLYLINE") {
      const v = e.v.map((q) => [g(q, 10), g(q, 20), g(q, 42)]);
      if (v.length > 1) {
        cl = (g(e, 70) & 1) === 1;
        p = verts2pts(v, cl);
        if (cl) p.pop();
      }
    } else if (e.t === "SPLINE") {
      const xs = all(e, 11);
      const ys = all(e, 21);
      const a = xs.length ? [xs, ys] : [all(e, 10), all(e, 20)];
      p = a[0].map((x, i) => [x, a[1][i]] as Pt);
      skip.SPLINE = 1;
    } else if (!["POINT", "TEXT", "MTEXT", "DIMENSION", "HATCH", "SOLID"].includes(e.t)) skip[e.t] = 1;
    if (p && p.length > 1) (cl ? loops : open).push(p);
  }
  return { loops: loops.concat(chain(open)), skip: Object.keys(skip) };
}

// ------------------------------------------------------------ geometry helpers

const area = (p: Pt[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    s += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return s / 2;
};
const per = (p: Pt[]) => p.reduce((s, q, i) => s + dist(q, p[(i + 1) % p.length]), 0);

function inside(pt: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

interface RawPart {
  outer: Pt[];
  holes: Pt[][];
  w: number;
  h: number;
  area: number;
  per: number;
}

interface Loop {
  pts: Pt[];
  a: number;
  d: number;
  par: number;
  part?: RawPart;
}

/** Plate thickness from a file name such as "PL20mm.dxf" or "plate 5 mm.dxf". */
export function thicknessFromName(name: string): number {
  const tm = name.match(/(\d+(?:[.,]\d+)?)[\s_]*mm/i);
  return tm ? +tm[1].replace(",", ".") : 0;
}

function extractParts(loops: Pt[][], sc: number): RawPart[] {
  const L: Loop[] = loops
    .map((l) => {
      const pts = l.map((p) => [p[0] * sc, p[1] * sc] as Pt);
      return { pts, a: Math.abs(area(pts)), d: 0, par: -1 };
    })
    .filter((l) => l.a > 1)
    .sort((x, y) => y.a - x.a);
  L.forEach((l, i) => {
    for (let j = 0; j < i; j++)
      if (inside(l.pts[0], L[j].pts)) {
        l.d++;
        l.par = j;
      }
  });
  const parts: RawPart[] = [];
  L.forEach((l) => {
    if (l.d % 2 === 0) {
      const part: RawPart = { outer: l.pts, holes: [], w: 0, h: 0, area: 0, per: 0 };
      parts.push(part);
      l.part = part;
    }
  });
  L.forEach((l) => {
    if (l.d % 2 === 1) L[l.par].part?.holes.push(l.pts);
  });
  for (const p of parts) {
    const xs = p.outer.map((q) => q[0]);
    const ys = p.outer.map((q) => q[1]);
    const mx = Math.min(...xs);
    const my = Math.min(...ys);
    const mv = (r: Pt[]) => r.map((q) => [q[0] - mx, q[1] - my] as Pt);
    p.outer = mv(p.outer);
    p.holes = p.holes.map(mv);
    p.w = Math.max(...xs) - mx;
    p.h = Math.max(...ys) - my;
    p.area = Math.abs(area(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(area(h)), 0);
    p.per = per(p.outer) + p.holes.reduce((s, h) => s + per(h), 0);
  }
  return parts;
}

export interface Counters {
  id: number;
  sn: number;
}

/**
 * Splits one DXF's contours into parts and merges them into `groups`
 * (identical parts share one row with a higher quantity). Returns the new
 * array and how many parts were found.
 */
export function addFileParts(
  groups: Group[],
  loops: Pt[][],
  name: string,
  scale: number,
  counters: Counters,
  /** Override the thickness / material / per-contour quantity (used when importing from Standard Calculations). */
  opts: { th?: number; material?: string; qty?: number } = {},
): { groups: Group[]; count: number } {
  const th = opts.th && opts.th > 0 ? opts.th : thicknessFromName(name);
  const material = (opts.material ?? "").trim();
  const add = Math.max(1, Math.round(opts.qty ?? 1));
  const out = groups.slice();
  const parts = extractParts(loops, scale);
  for (const p of parts) {
    const m = out.find(
      (g) =>
        g.th === th &&
        g.material === material &&
        g.holes.length === p.holes.length &&
        Math.abs(g.area - p.area) <= g.area * 0.002 + 0.5 &&
        Math.abs(g.per - p.per) <= g.per * 0.005 + 0.5 &&
        Math.abs(Math.max(g.w, g.h) - Math.max(p.w, p.h)) < 0.3,
    );
    if (m) out[out.indexOf(m)] = { ...m, qty: m.qty + add };
    else out.push({ ...p, id: counters.id++, sn: ++counters.sn, name, qty: add, th, material });
  }
  return { groups: out, count: parts.length };
}

// ------------------------------------------------------------- transformations

const normAngle = (a: number) => {
  const r = Math.round((((a % 360) + 360) % 360) * 1000) / 1000;
  return r >= 360 ? 0 : r;
};

interface RotBox {
  w: number;
  h: number;
  mx: number;
  my: number;
}
const rotBoxCache = new WeakMap<Group, Map<number, RotBox>>();

/** Size of the part after rotating it by `rot` degrees (mx/my = offset that moves its bbox back to 0,0). */
export function rotBox(g: Group, rot: number): RotBox {
  if (rot % 90 === 0) return rot % 180 ? { w: g.h, h: g.w, mx: 0, my: 0 } : { w: g.w, h: g.h, mx: 0, my: 0 };
  let m = rotBoxCache.get(g);
  if (!m) rotBoxCache.set(g, (m = new Map()));
  const hit = m.get(rot);
  if (hit) return hit;
  const t = (rot * Math.PI) / 180;
  const c = Math.cos(t);
  const sn = Math.sin(t);
  let x0 = 1e18;
  let y0 = 1e18;
  let x1 = -1e18;
  let y1 = -1e18;
  for (const r of [g.outer, ...(g.extra || [])])
    for (const [x, y] of r) {
      const X = x * c - y * sn;
      const Y = x * sn + y * c;
      x0 = Math.min(x0, X);
      y0 = Math.min(y0, Y);
      x1 = Math.max(x1, X);
      y1 = Math.max(y1, Y);
    }
  const b = { w: x1 - x0, h: y1 - y0, mx: x0, my: y0 };
  m.set(rot, b);
  return b;
}

/** Rotates a point of the part; the rotated part's bounding box always starts at (0, 0). */
export function tp(g: Group, rot: number, p: Pt): Pt {
  const [x, y] = p;
  if (rot === 0) return [x, y];
  if (rot === 90) return [g.h - y, x];
  if (rot === 180) return [g.w - x, g.h - y];
  if (rot === 270) return [y, g.w - x];
  const t = (rot * Math.PI) / 180;
  const b = rotBox(g, rot);
  return [x * Math.cos(t) - y * Math.sin(t) - b.mx, x * Math.sin(t) + y * Math.cos(t) - b.my];
}

export function path(g: Group, rot: number, dx: number, dy: number): Path2D {
  const P = new Path2D();
  for (const r of [g.outer, ...g.holes, ...(g.extra || [])]) {
    r.forEach((p, i) => {
      const [x, y] = tp(g, rot, p);
      if (i) P.lineTo(x + dx, y + dy);
      else P.moveTo(x + dx, y + dy);
    });
    P.closePath();
  }
  return P;
}

export const partColor = (g: Group) => `hsl(${(((g.cid ?? g.id) * 67) % 360)} 60% 55%)`;

/** Two identical right/any triangles nested as one rectangle-ish pair. */
export function pairOf(g: Group, common: boolean, gap: number): Group | null {
  if (g.outer.length !== 3 || g.holes.length) return null;
  const P = g.outer;
  let bi = 0;
  let bl = 0;
  for (let i = 0; i < 3; i++) {
    const l = dist(P[i], P[(i + 1) % 3]);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const p = P[bi];
  const q = P[(bi + 1) % 3];
  const r = P[(bi + 2) % 3];
  const r2: Pt = [p[0] + q[0] - r[0], p[1] + q[1] - r[1]];
  let outer: Pt[];
  let extra: Pt[][] = [];
  if (common) outer = [p, r, q, r2];
  else {
    let nx = -(q[1] - p[1]) / bl;
    let ny = (q[0] - p[0]) / bl;
    if ((r[0] - p[0]) * nx + (r[1] - p[1]) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    outer = [p, q, r];
    extra = [[q, p, r2].map((a) => [a[0] + nx * gap, a[1] + ny * gap] as Pt)];
  }
  const allPts = outer.concat(...extra);
  const mx = Math.min(...allPts.map((a) => a[0]));
  const my = Math.min(...allPts.map((a) => a[1]));
  const mv = (R: Pt[]) => R.map((a) => [a[0] - mx, a[1] - my] as Pt);
  outer = mv(outer);
  extra = extra.map(mv);
  const a2 = outer.concat(...extra);
  return {
    ...g,
    id: 1000 + g.id,
    cid: g.id,
    outer,
    holes: [],
    extra,
    w: Math.max(...a2.map((a) => a[0])),
    h: Math.max(...a2.map((a) => a[1])),
    area: 2 * g.area,
    n: 2,
  };
}

// ------------------------------------------------------------------- placement

interface Mask {
  mw: number;
  mh: number;
  pad: number;
  /** Extent of the cells the part really occupies inside the mask box (the padding around
   *  them is empty). Placement is limited by these, not by the padded box — otherwise the
   *  padding would eat sheet capacity (e.g. 4 x 1500 mm no longer fit a 6000 mm sheet). */
  minC: number;
  maxC: number;
  minR: number;
  maxR: number;
  off: Int32Array;
}
type MaskCache = Map<string, Mask>;
interface Slot {
  sc: number;
  gx: number;
  gy: number;
  rot: number;
  m: Mask;
}

/** Rotation angles the optimizer may try, for the "Rotation" setting (0 none, 1 = 0/180, 2 = 90 steps, 3 = 45 steps, 4 = 15 steps). */
export function rotList(ro: number): number[] {
  if (ro === 0) return [0];
  if (ro === 1) return [0, 180];
  const step = ro === 2 ? 90 : ro === 3 ? 45 : 15;
  return Array.from({ length: 360 / step }, (_, i) => i * step);
}

export function makeSettings(v: { W: number; H: number; mg: number; gp: number; cell: number; ro: number }): Settings {
  const x0 = v.mg - v.gp / 2;
  return {
    ...v,
    x0,
    GW: Math.floor((v.W - 2 * v.mg + v.gp) / v.cell),
    GH: Math.floor((v.H - 2 * v.mg + v.gp) / v.cell),
  };
}

function mask(S: Settings, rc: MaskCache, g: Group, rot: number): Mask {
  const k = [g.id, rot, S.cell, S.gp].join();
  const hit = rc.get(k);
  if (hit) return hit;
  const { w: bw, h: bh } = rotBox(g, rot);
  const pad = Math.ceil(S.gp / 2 / S.cell) + 1;
  const mw = Math.ceil(bw / S.cell) + 2 * pad;
  const mh = Math.ceil(bh / S.cell) + 2 * pad;
  const cv = document.createElement("canvas");
  cv.width = mw;
  cv.height = mh;
  const c = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  c.setTransform(1 / S.cell, 0, 0, 1 / S.cell, pad, pad);
  const P = path(g, rot, 0, 0);
  c.fill(P, "evenodd");
  c.lineWidth = S.gp;
  c.lineJoin = "round";
  if (S.gp > 0) c.stroke(P);
  const d = c.getImageData(0, 0, mw, mh).data;
  const o: number[] = [];
  let minC = mw, maxC = -1, minR = mh, maxR = -1;
  for (let r = 0; r < mh; r++)
    for (let q = 0; q < mw; q++)
      if (d[(r * mw + q) * 4 + 3] > 0) {
        o.push(r * S.GW + q);
        if (q < minC) minC = q;
        if (q > maxC) maxC = q;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
  if (maxC < 0) { minC = maxC = minR = maxR = 0; }
  const m: Mask = { mw, mh, pad, minC, maxC, minR, maxR, off: Int32Array.from(o) };
  rc.set(k, m);
  return m;
}

function place(S: Settings, rc: MaskCache, sh: Sheet, g: Group, rots: number[]): Slot | null {
  let best: Slot | null = null;
  for (const rot of rots) {
    const m = mask(S, rc, g, rot);
    if (m.maxC - m.minC + 1 > S.GW || m.maxR - m.minR + 1 > S.GH) continue;
    const G = sh.grid as Uint8Array;
    const o = m.off;
    // gx/gy are the mask box's origin; only the occupied cells (minC..maxC / minR..maxR) must
    // stay inside the grid, so the origin may sit a few cells outside it (empty padding).
    const lim = Math.min(best ? best.sc - (m.maxC + 1) : 1e9, S.GW - 1 - m.maxC);
    for (let gx = -m.minC; gx <= lim; gx++) {
      let f = -Infinity;
      for (let gy = -m.minR; gy <= S.GH - 1 - m.maxR; gy++) {
        const b = gy * S.GW + gx;
        let ok = true;
        for (let k = 0; k < o.length; k++)
          if (G[b + o[k]]) {
            ok = false;
            break;
          }
        if (ok) {
          f = gy;
          break;
        }
      }
      if (f > -Infinity) {
        const sc = gx + m.maxC + 1;
        if (!best || sc < best.sc || (sc === best.sc && f < best.gy)) best = { sc, gx, gy: f, rot, m };
        break;
      }
    }
  }
  return best;
}

function commit(S: Settings, sh: Sheet, g: Group, b: Slot) {
  const b0 = b.gy * S.GW + b.gx;
  for (const k of b.m.off) (sh.grid as Uint8Array)[b0 + k] = 1;
  sh.used = Math.max(sh.used, b.sc);
  sh.items.push({ g, rot: b.rot, x: S.x0 + (b.gx + b.m.pad) * S.cell, y: S.x0 + (b.gy + b.m.pad) * S.cell });
}

const tick = () => new Promise<void>((r) => setTimeout(r));

async function attempt(S: Settings, rc: MaskCache, items: Group[], rots: number[], stop: () => boolean) {
  const sheets: Sheet[] = [];
  const un: Group[] = [];
  for (let n = 0; n < items.length; n++) {
    const g = items[n];
    let ok = false;
    for (const sh of sheets) {
      const b = place(S, rc, sh, g, rots);
      if (b) {
        commit(S, sh, g, b);
        ok = true;
        break;
      }
    }
    if (!ok) {
      const sh: Sheet = { grid: new Uint8Array(S.GW * S.GH), items: [], used: 0, th: 0, material: "" };
      const b = place(S, rc, sh, g, rots);
      if (b) {
        commit(S, sh, g, b);
        sheets.push(sh);
      } else un.push(g);
    }
    if (n % 2 === 0) await tick();
    if (stop()) break;
  }
  const sc =
    un.length * 1e9 + (sheets.length - 1) * 1e7 + (sheets.length ? sheets[sheets.length - 1].used : 0);
  return { sheets, un, sc };
}

export interface OptimizeOptions {
  S: Settings;
  pair: boolean;
  common: boolean;
  timeSec: number;
  shouldStop: () => boolean;
  onBest: (res: OptResult) => void;
  onStatus: (text: string) => void;
}

/** Returns null when there is nothing to nest (all quantities are 0). */
export async function runOptimize(groups: Group[], o: OptimizeOptions): Promise<OptResult | null> {
  const { S } = o;
  const rc: MaskCache = new Map();
  const skip = groups.filter((g) => !g.qty).map((g) => `Part #${g.sn} (${g.name}) was skipped: quantity is 0`);
  const items: Group[] = [];
  groups.forEach((g) => {
    let n = g.qty;
    const pg = o.pair ? pairOf(g, o.common, S.gp) : null;
    if (pg) {
      for (let i = 0; i < n >> 1; i++) items.push(pg);
      n &= 1;
    }
    for (let i = 0; i < n; i++) items.push(g);
  });
  if (!items.length) return null;

  const R = rotList(S.ro);
  const key: ((g: Group) => number)[] = [
    (g) => g.area,
    (g) => Math.max(g.w, g.h),
    (g) => g.h,
    (g) => g.w * g.h * (0.6 + 0.8 * Math.random()),
  ];
  // Parts only share a sheet when both thickness AND material match.
  const lots = Array.from(new Set(items.map((g) => `${g.th || 0}\u0000${g.material || ""}`)))
    .map((k) => {
      const i = k.indexOf("\u0000");
      return { th: +k.slice(0, i), material: k.slice(i + 1) };
    })
    .sort((a, b) => a.th - b.th || a.material.localeCompare(b.material));
  const done: Sheet[] = [];
  const dun: Group[] = [];
  let it = 0;
  const cur = (b: { sheets: Sheet[]; un: Group[] } | null): OptResult => ({
    sheets: done.concat(b ? b.sheets : []),
    un: dun.concat(b ? b.un : []),
    skip,
  });

  for (const { th, material } of lots) {
    const sub = items.filter((g) => (g.th || 0) === th && (g.material || "") === material);
    const t0 = performance.now();
    const lim = (o.timeSec * 1000) / lots.length;
    let best: { sheets: Sheet[]; un: Group[]; sc: number } | null = null;
    let k = 0;
    while (!o.shouldStop() && (k === 0 || performance.now() - t0 < lim)) {
      const kf = k < 3 ? key[k] : key[3];
      const ord = sub.slice().sort((a, b) => kf(b) - kf(a));
      let rr = R;
      if (k >= 4 && R.length >= 3) {
        if (S.ro === 2) rr = [R, [0, 180], [0, 90], [0, 270, 90, 180]][(Math.random() * 4) | 0];
        else {
          // finer rotation modes: vary the search order / the allowed set between iterations
          const pick = (Math.random() * 3) | 0;
          rr = pick === 0 ? R : pick === 1 ? R.filter((a) => a % 90 === 0) : R.slice().sort(() => Math.random() - 0.5);
        }
      }
      const r = await attempt(S, rc, ord, rr, o.shouldStop);
      k++;
      it++;
      r.sheets.forEach((x) => {
        x.th = th;
        x.material = material;
      });
      if (!o.shouldStop() && (!best || r.sc < best.sc)) {
        best = r;
        o.onBest(cur(best));
      }
      const lbl = material ? `${material} • ${th || "?"} mm` : `${th || "?"} mm`;
      o.onStatus(`${lbl} • iteration ${it} • sheets: ${done.length + (best ? best.sheets.length : 0)}`);
    }
    if (best) {
      done.push(...best.sheets);
      dun.push(...best.un);
    }
  }
  done.forEach((s) => delete s.grid);
  return cur(null);
}

// ----------------------------------------------------- manual editing (pick up)

export interface Sides {
  o: Pt[][];
  h: Pt[][];
}
type BBox = [number, number, number, number];

export function sides(it: Item): Sides {
  const f = (r: Pt[]) =>
    r.map((p) => {
      const q = tp(it.g, it.rot, p);
      return [q[0] + it.x, q[1] + it.y] as Pt;
    });
  return { o: [it.g.outer, ...(it.g.extra || [])].map(f), h: it.g.holes.map(f) };
}

export function bbox(R: Pt[][]): BBox {
  let a = 1e9;
  let b = 1e9;
  let c = -1e9;
  let d = -1e9;
  for (const r of R)
    for (const p of r) {
      a = Math.min(a, p[0]);
      b = Math.min(b, p[1]);
      c = Math.max(c, p[0]);
      d = Math.max(d, p[1]);
    }
  return [a, b, c, d];
}

function segX(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function ringX(r1: Pt[], r2: Pt[]) {
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i];
    const b = r1[(i + 1) % r1.length];
    for (let j = 0; j < r2.length; j++) if (segX(a, b, r2[j], r2[(j + 1) % r2.length])) return true;
  }
  return false;
}
function solid(pt: Pt, s: Sides) {
  return s.o.some((r) => inside(pt, r)) && !s.h.some((r) => inside(pt, r));
}
function hit(A: Sides, B: Sides) {
  const x = bbox(A.o);
  const y = bbox(B.o);
  if (x[0] > y[2] || y[0] > x[2] || x[1] > y[3] || y[1] > x[3]) return false;
  for (const r of A.o.concat(A.h)) for (const q of B.o.concat(B.h)) if (ringX(r, q)) return true;
  return A.o.some((r) => solid(r[0], B)) || B.o.some((r) => solid(r[0], A));
}
interface Other {
  s: Sides;
  bb: BBox;
  it: Item;
}

// ---------------------------------------------------- spacing exactly like the optimiser
// The optimiser puts parts on a grid of `cell` mm and blocks every grid cell touched by the part grown by
// spacing/2. Two parts may therefore be a little further apart than `spacing` (up to one cell more per side).
// Manual editing uses the very same cells, so a hand-made nest keeps the same gaps as an optimised one and a part
// can never be dropped into the free zone around another part.

/** Occupied grid cells of a part at one rotation, as column runs per row (same rasterisation as the optimiser). */
interface Cells {
  pad: number;
  minC: number;
  maxC: number;
  minR: number;
  maxR: number;
  /** rows[r] = [start0, end0, start1, end1, ...] (inclusive column runs) */
  rows: Int32Array[];
}

type CellCanvasFactory = (w: number, h: number) => HTMLCanvasElement;
let cellCanvas: CellCanvasFactory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
/** Lets tests (no DOM) supply their own canvas. */
export function setCellCanvasFactory(f: CellCanvasFactory) {
  cellCanvas = f;
}

const cellsCache = new WeakMap<Group, Map<string, Cells>>();

function cellsOf(S: Settings, g: Group, rot: number): Cells {
  let m = cellsCache.get(g);
  if (!m) cellsCache.set(g, (m = new Map()));
  const key = `${rot}|${S.cell}|${S.gp}`;
  const hit = m.get(key);
  if (hit) return hit;
  const { w: bw, h: bh } = rotBox(g, rot);
  const pad = Math.ceil(S.gp / 2 / S.cell) + 1;
  const mw = Math.ceil(bw / S.cell) + 2 * pad;
  const mh = Math.ceil(bh / S.cell) + 2 * pad;
  const c = cellCanvas(mw, mh).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  c.setTransform(1 / S.cell, 0, 0, 1 / S.cell, pad, pad);
  c.beginPath();
  for (const r of [g.outer, ...g.holes, ...(g.extra || [])]) {
    r.forEach((p, i) => {
      const [x, y] = tp(g, rot, p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.closePath();
  }
  c.fill("evenodd");
  c.lineWidth = S.gp;
  c.lineJoin = "round";
  if (S.gp > 0) c.stroke();
  const d = c.getImageData(0, 0, mw, mh).data;
  const rows: Int32Array[] = [];
  let minC = mw, maxC = -1, minR = mh, maxR = -1;
  for (let r = 0; r < mh; r++) {
    const runs: number[] = [];
    let start = -1;
    for (let q = 0; q <= mw; q++) {
      const on = q < mw && d[(r * mw + q) * 4 + 3] > 0;
      if (on && start < 0) start = q;
      if (!on && start >= 0) {
        runs.push(start, q - 1);
        minC = Math.min(minC, start);
        maxC = Math.max(maxC, q - 1);
        start = -1;
      }
    }
    if (runs.length) {
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    rows.push(Int32Array.from(runs));
  }
  if (maxC < 0) minC = maxC = minR = maxR = 0;
  const out: Cells = { pad, minC, maxC, minR, maxR, rows };
  m.set(key, out);
  return out;
}

/** Grid position (in cells) of the mask origin of a part placed at (x, y). */
const cellOrigin = (S: Settings, cs: Cells, x: number, y: number): Pt => [
  Math.round((x - S.x0) / S.cell) - cs.pad,
  Math.round((y - S.x0) / S.cell) - cs.pad,
];

/** Snaps a coordinate to the optimiser's grid (parts always sit on grid points, like optimised ones). */
export const snapV = (S: Settings, v: number) => S.x0 + Math.round((v - S.x0) / S.cell) * S.cell;

function cellsHit(a: Cells, ax: number, ay: number, b: Cells, bx: number, by: number): boolean {
  if (ax + a.maxC < bx + b.minC || bx + b.maxC < ax + a.minC || ay + a.maxR < by + b.minR || by + b.maxR < ay + a.minR) return false;
  const r0 = Math.max(ay + a.minR, by + b.minR);
  const r1 = Math.min(ay + a.maxR, by + b.maxR);
  for (let r = r0; r <= r1; r++) {
    const ra = a.rows[r - ay];
    const rb = b.rows[r - by];
    if (!ra || !rb) continue;
    let i = 0;
    let j = 0;
    while (i < ra.length && j < rb.length) {
      const e1 = ra[i + 1] + ax;
      const s2 = rb[j] + bx;
      const e2 = rb[j + 1] + bx;
      if (e1 < s2) i += 2;
      else if (e2 < ra[i] + ax) j += 2;
      else return true;
    }
  }
  return false;
}

/** True when part `it` (at x, y) would break the sheet's grid limits or share a cell with any of `oth`. */
function gridBad(S: Settings, sh: Sheet, it: Item, x: number, y: number, oth: Other[]): boolean {
  const cs = cellsOf(S, it.g, it.rot);
  const [ax, ay] = cellOrigin(S, cs, x, y);
  const W = sh.W ?? S.W;
  const H = sh.H ?? S.H;
  const GW = Math.floor((W - 2 * S.mg + S.gp) / S.cell);
  const GH = Math.floor((H - 2 * S.mg + S.gp) / S.cell);
  if (ax + cs.minC < 0 || ay + cs.minR < 0 || ax + cs.maxC > GW - 1 || ay + cs.maxR > GH - 1) return true;
  const reach = S.gp + 2 * S.cell;
  const b0 = bbox(sides(it).o);
  const b: BBox = [b0[0] + x - it.x, b0[1] + y - it.y, b0[2] + x - it.x, b0[3] + y - it.y];
  for (const o of oth) {
    if (b[0] > o.bb[2] + reach || o.bb[0] > b[2] + reach || b[1] > o.bb[3] + reach || o.bb[1] > b[3] + reach) continue;
    const oc = cellsOf(S, o.it.g, o.it.rot);
    const [bx, by] = cellOrigin(S, oc, o.it.x, o.it.y);
    if (cellsHit(cs, ax, ay, oc, bx, by)) return true;
  }
  return false;
}

export interface Sel {
  sh: Sheet;
  origSh: Sheet;
  idx: number;
  it: Item;
  oth: Other[];
  off: Pt;
  pm: Pt;
  orig: { x: number; y: number; rot: number };
  lw?: number;
  /** True while the held part overlaps something / enters the margin (drawn red, can't be placed). */
  bad?: boolean;
  /** The part was taken from the parts list (manual nesting), not picked up from a sheet. */
  fresh?: boolean;
}

/** A part taken from the list that has not touched any sheet yet (it floats with the cursor). */
export const inGhost = (sel: Sel) => !!sel.fresh && sel.sh === sel.origSh;

/** Physical pieces of every part group currently on the sheets (paired triangles count as 2). */
export function placedCounts(res: OptResult | null): Map<number, number> {
  const m = new Map<number, number>();
  if (!res) return m;
  for (const sh of res.sheets)
    for (const it of sh.items) {
      const id = it.g.cid ?? it.g.id;
      m.set(id, (m.get(id) ?? 0) + (it.g.n || 1));
    }
  return m;
}

/** Pieces of `g` still available to place by hand (never negative). */
export const leftOf = (g: Group, placed: Map<number, number>) => Math.max(0, g.qty - (placed.get(g.id) ?? 0));

/** Re-derives the "not nested" list from quantities after a manual change. */
export function syncUnplaced(res: OptResult, groups: Group[]) {
  const placed = placedCounts(res);
  const un: Group[] = [];
  for (const g of groups) for (let i = leftOf(g, placed); i > 0; i--) un.push(g);
  res.un = un;
}

export function newSheet(th: number, material: string): Sheet {
  return { items: [], th, material, used: 0 };
}

/** Starts holding a brand-new copy of `g` taken from the parts list. */
export function startNew(g: Group): Sel {
  const it: Item = { g, rot: 0, x: 0, y: 0 };
  // detached sheet that only carries the part's thickness/material until it enters a real sheet
  const ghost = newSheet(g.th, g.material);
  ghost.items.push(it);
  return { sh: ghost, origSh: ghost, idx: -1, it, oth: [], pm: [0, 0], off: [0, 0], orig: { x: 0, y: 0, rot: 0 }, bad: false, fresh: true };
}

export function othersOf(sh: Sheet, f: Item): Other[] {
  return sh.items
    .filter((o) => o !== f)
    .map((o) => {
      const q = sides(o);
      return { s: q, bb: bbox(q.o), it: o };
    });
}

export function startPick(sh: Sheet, idx: number, it: Item, m: Pt): Sel {
  return {
    sh,
    origSh: sh,
    idx,
    it,
    oth: othersOf(sh, it),
    pm: m,
    off: [m[0] - it.x, m[1] - it.y],
    orig: { x: it.x, y: it.y, rot: it.rot },
    bad: false,
  };
}

/** Puts a picked part back where it was picked up (Esc). */
export function cancelPick(sel: Sel) {
  const it = sel.it;
  if (sel.sh !== sel.origSh) {
    const a = sel.sh.items;
    a.splice(a.indexOf(it), 1);
    sel.origSh.items.push(it);
  }
  it.x = sel.orig.x;
  it.y = sel.orig.y;
  it.rot = sel.orig.rot;
  sel.bad = false;
}

export function isBad(sel: Sel, S: Settings) {
  if (inGhost(sel)) return false;
  const A = sides(sel.it);
  const b = bbox(A.o);
  const W = sel.sh.W ?? S.W;
  const H = sel.sh.H ?? S.H;
  if (b[0] < S.mg - 0.01 || b[1] < S.mg - 0.01 || b[2] > W - S.mg + 0.01 || b[3] > H - S.mg + 0.01) return true;
  // same spacing rule as the optimiser: never share a grid cell with another part's spacing zone
  return gridBad(S, sel.sh, sel.it, sel.it.x, sel.it.y, sel.oth);
}
function tryPos(sel: Sel, S: Settings, x: number, y: number) {
  const it = sel.it;
  const ox = it.x;
  const oy = it.y;
  it.x = snapV(S, x);
  it.y = snapV(S, y);
  if (it.x === ox && it.y === oy) return true; // sub-cell movement: stay put
  if (isBad(sel, S)) {
    it.x = ox;
    it.y = oy;
    return false;
  }
  return true;
}
export function moveTo(sel: Sel, S: Settings, tx: number, ty: number) {
  if (sel.bad) {
    // The part is currently in an invalid spot (forced rotation): let it move
    // freely so it can be dragged out; it becomes normal again once it is valid.
    sel.it.x = tx;
    sel.it.y = ty;
    sel.bad = isBad(sel, S);
    return;
  }
  if (tryPos(sel, S, tx, ty)) return;
  const it = sel.it;
  const n = Math.max(1, Math.ceil(Math.hypot(tx - it.x, ty - it.y) / 3));
  const sx = (tx - it.x) / n;
  const sy = (ty - it.y) / n;
  for (let i = 0; i < n; i++) {
    const x = it.x + sx;
    const y = it.y + sy;
    if (!tryPos(sel, S, x, y) && !tryPos(sel, S, x, it.y) && !tryPos(sel, S, it.x, y)) break;
  }
}
/** Moves the picked part onto another sheet of the same thickness. */
export function transfer(sel: Sel, S: Settings, sh: Sheet, idx: number, m: Pt): boolean {
  const it = sel.it;
  if ((sh.th || 0) !== (sel.sh.th || 0)) return false;
  if ((sh.material || "") !== (sel.sh.material || "")) return false;
  if (inGhost(sel)) {
    // first contact with a sheet: hold the part by the centre of its bounding box
    const b = bbox(sides(it).o);
    sel.off = [(b[0] + b[2]) / 2 - it.x, (b[1] + b[3]) / 2 - it.y];
  }
  const sv = { sh: sel.sh, idx: sel.idx, oth: sel.oth, x: it.x, y: it.y };
  sel.sh = sh;
  sel.idx = idx;
  sel.oth = othersOf(sh, it);
  it.x = snapV(S, m[0] - sel.off[0]);
  it.y = snapV(S, m[1] - sel.off[1]);
  const bad = isBad(sel, S);
  if (bad && !sel.bad) {
    sel.sh = sv.sh;
    sel.idx = sv.idx;
    sel.oth = sv.oth;
    it.x = sv.x;
    it.y = sv.y;
    return false;
  }
  sel.bad = bad;
  const a = sv.sh.items;
  a.splice(a.indexOf(it), 1);
  sh.items.push(it);
  return true;
}
/** Rotates the picked part by `d` degrees (any angle) around the centre of its bounding box. */
export function rotate(sel: Sel, S: Settings, d: number) {
  const it = sel.it;
  const b = bbox(sides(it).o);
  it.rot = normAngle(it.rot + d);
  const c = bbox(sides(it).o);
  it.x = snapV(S, it.x + (b[0] + b[2] - c[0] - c[2]) / 2);
  it.y = snapV(S, it.y + (b[1] + b[3] - c[1] - c[3]) / 2);
  // Rotation is never blocked: if there's no room the part turns anyway and is
  // flagged invalid (drawn red) until it is moved to a free spot.
  sel.bad = isBad(sel, S);
  sel.off = [sel.pm[0] - it.x, sel.pm[1] - it.y];
}

// ------------------------------------------------- multi-selection (CAD-style box select)

/** Several parts of ONE sheet selected together; they move as a rigid group. */
export interface MultiSel {
  sh: Sheet;
  idx: number;
  items: Item[];
  /** Picked up with a double-click: the whole group follows the mouse until a click places it (Esc cancels). */
  carry?: boolean;
  /** Where the group was when it was picked up (so Esc can bring it back, even from another sheet). */
  home?: { sh: Sheet; pos: Pt[]; rot?: number[] };
  /** Only while a move is in progress (mouse drag / arrow key / carrying). */
  drag?: {
    pm: Pt;
    base: Pt[];
    own: Sides[];
    obb: BBox[];
    oth: Other[];
    d: Pt;
    /** Last pointer position (mm) seen by moveGroup; a rotation restarts the drag from here. */
    ptr: Pt;
    /** Started in an invalid spot: moves freely until valid again (same rule as a single part). */
    bad: boolean;
  };
}

/**
 * Parts picked by a selection rectangle `r` = [x0, y0, x1, y1] (mm, any corner order).
 *  - window (cross = false, drag left → right): only parts that are completely inside the rectangle.
 *  - crossing (cross = true, drag right → left): every part the rectangle touches or overlaps.
 */
export function itemsInRect(sh: Sheet, r: BBox, cross: boolean): Item[] {
  const x0 = Math.min(r[0], r[2]);
  const x1 = Math.max(r[0], r[2]);
  const y0 = Math.min(r[1], r[3]);
  const y1 = Math.max(r[1], r[3]);
  const ring: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const R: Sides = { o: [ring], h: [] };
  const out: Item[] = [];
  for (const it of sh.items) {
    const A = sides(it);
    const b = bbox(A.o);
    if (cross) {
      if (b[0] > x1 || b[2] < x0 || b[1] > y1 || b[3] < y0) continue;
      if (hit(A, R)) out.push(it);
    } else if (b[0] >= x0 && b[2] <= x1 && b[1] >= y0 && b[3] <= y1) out.push(it);
  }
  return out;
}

/** Freezes the current geometry and starts moving the group (`m` = pointer position in mm). */
export function startGroupDrag(ms: MultiSel, S: Settings, m: Pt) {
  const chosen = new Set(ms.items);
  const own = ms.items.map((it) => sides(it));
  ms.drag = {
    pm: m,
    base: ms.items.map((it) => [it.x, it.y] as Pt),
    own,
    obb: own.map((q) => bbox(q.o)),
    oth: ms.sh.items.filter((o) => !chosen.has(o)).map((o) => {
      const q = sides(o);
      return { s: q, bb: bbox(q.o), it: o };
    }),
    d: [0, 0],
    ptr: m,
    bad: false,
  };
  ms.drag.bad = groupBad(ms, S, 0, 0);
}

/** True when moving the whole group by (dx, dy) from where the drag started is not allowed. */
function groupBad(ms: MultiSel, S: Settings, dx: number, dy: number): boolean {
  const d = ms.drag as NonNullable<MultiSel["drag"]>;
  const W = ms.sh.W ?? S.W;
  const H = ms.sh.H ?? S.H;
  for (let i = 0; i < ms.items.length; i++) {
    const b = d.obb[i];
    if (b[0] + dx < S.mg - 0.01 || b[1] + dy < S.mg - 0.01 || b[2] + dx > W - S.mg + 0.01 || b[3] + dy > H - S.mg + 0.01) return true;
    if (gridBad(S, ms.sh, ms.items[i], d.base[i][0] + dx, d.base[i][1] + dy, d.oth)) return true;
  }
  return false;
}

/**
 * Moves the group so the pointer offset from the drag start is (dx, dy), in whole grid cells like optimised parts.
 * Like a single part, it stops at the last allowed position (slides along walls / other parts) instead of ever
 * getting closer than the optimiser's spacing or leaving the margin.
 */
export function moveGroup(ms: MultiSel, S: Settings, dx: number, dy: number) {
  const d = ms.drag;
  if (!d) return;
  d.ptr = [d.pm[0] + dx, d.pm[1] + dy];
  const c = S.cell;
  const apply = (cx: number, cy: number) => {
    d.d = [cx * c, cy * c];
    ms.items.forEach((it, i) => {
      it.x = d.base[i][0] + cx * c;
      it.y = d.base[i][1] + cy * c;
    });
  };
  const tx = Math.round(dx / c);
  const ty = Math.round(dy / c);
  if (d.bad) {
    apply(tx, ty);
    d.bad = groupBad(ms, S, tx * c, ty * c);
    return;
  }
  let x = Math.round(d.d[0] / c);
  let y = Math.round(d.d[1] / c);
  if (x === tx && y === ty) return;
  if (!groupBad(ms, S, tx * c, ty * c)) {
    apply(tx, ty);
    return;
  }
  const steps = Math.max(Math.abs(tx - x), Math.abs(ty - y));
  for (let i = 0; i < steps; i++) {
    const sx = Math.sign(tx - x);
    const sy = Math.sign(ty - y);
    if (sx && sy && !groupBad(ms, S, (x + sx) * c, (y + sy) * c)) {
      x += sx;
      y += sy;
    } else if (sx && !groupBad(ms, S, (x + sx) * c, y * c)) x += sx;
    else if (sy && !groupBad(ms, S, x * c, (y + sy) * c)) y += sy;
    else break;
  }
  apply(x, y);
}

/** Puts the group back where it was when the drag/carry started (Esc), on its original sheet. */
export function cancelGroupDrag(ms: MultiSel) {
  const h = ms.home;
  if (h) {
    if (h.sh !== ms.sh) {
      for (const it of ms.items) {
        const i = ms.sh.items.indexOf(it);
        if (i >= 0) ms.sh.items.splice(i, 1);
        h.sh.items.push(it);
      }
      ms.sh = h.sh;
    }
    ms.items.forEach((it, i) => {
      it.x = h.pos[i][0];
      it.y = h.pos[i][1];
      if (h.rot) it.rot = h.rot[i];
    });
    ms.home = undefined;
    ms.drag = undefined;
    return;
  }
  const d = ms.drag;
  if (!d) return;
  ms.items.forEach((it, i) => {
    it.x = d.base[i][0];
    it.y = d.base[i][1];
  });
  ms.drag = undefined;
}

/**
 * Carries the whole group onto another sheet of the same thickness / material. The group is centred on the pointer
 * (pulled back inside the margin) and moves over only if every part fits there. Returns false when it does not.
 */
export function transferGroup(ms: MultiSel, S: Settings, sh: Sheet, idx: number, m: Pt): boolean {
  if (sh === ms.sh) return true;
  if ((sh.th || 0) !== (ms.sh.th || 0) || (sh.material || "") !== (ms.sh.material || "")) return false;
  const bs = ms.items.map((it) => bbox(sides(it).o));
  const x0 = Math.min(...bs.map((q) => q[0]));
  const y0 = Math.min(...bs.map((q) => q[1]));
  const x1 = Math.max(...bs.map((q) => q[2]));
  const y1 = Math.max(...bs.map((q) => q[3]));
  const W = sh.W ?? S.W;
  const H = sh.H ?? S.H;
  const c = S.cell;
  // whole-cell shifts that keep the group's bounding box inside the margin
  const lox = Math.ceil((S.mg - x0) / c) * c;
  const hix = Math.floor((W - S.mg - x1) / c) * c;
  const loy = Math.ceil((S.mg - y0) / c) * c;
  const hiy = Math.floor((H - S.mg - y1) / c) * c;
  if (lox > hix || loy > hiy) return false;
  const dx = Math.max(lox, Math.min(hix, Math.round((m[0] - (x0 + x1) / 2) / c) * c));
  const dy = Math.max(loy, Math.min(hiy, Math.round((m[1] - (y0 + y1) / 2) / c) * c));
  const oth: Other[] = sh.items.map((o) => {
    const q = sides(o);
    return { s: q, bb: bbox(q.o), it: o };
  });
  for (const it of ms.items) if (gridBad(S, sh, it, it.x + dx, it.y + dy, oth)) return false;
  for (const it of ms.items) {
    const i = ms.sh.items.indexOf(it);
    if (i >= 0) ms.sh.items.splice(i, 1);
    it.x += dx;
    it.y += dy;
    sh.items.push(it);
  }
  ms.sh = sh;
  ms.idx = idx;
  startGroupDrag(ms, S, m);
  return true;
}

/** Moves the selected group by a small step (arrow keys); it stops at the last allowed position. */
export function nudgeGroup(ms: MultiSel, S: Settings, dx: number, dy: number) {
  startGroupDrag(ms, S, [0, 0]);
  moveGroup(ms, S, dx, dy);
  ms.drag = undefined;
}

/**
 * Rotates the whole selection as one rigid block by `d` degrees (counter-clockwise, like a single part) around the
 * centre of its bounding box. Like a single part, rotation is never blocked: when there is no room the group turns
 * anyway and is flagged `drag.bad` (drawn red, can't be placed) until it is moved to a free spot.
 * Needs an active drag (start one with startGroupDrag first).
 */
export function rotateGroup(ms: MultiSel, S: Settings, d: number) {
  const dr = ms.drag;
  if (!dr) return;
  const bs = ms.items.map((it) => bbox(sides(it).o));
  const cx = (Math.min(...bs.map((q) => q[0])) + Math.max(...bs.map((q) => q[2]))) / 2;
  const cy = (Math.min(...bs.map((q) => q[1])) + Math.max(...bs.map((q) => q[3]))) / 2;
  const t = (d * Math.PI) / 180;
  const co = Math.cos(t);
  const si = Math.sin(t);
  for (const it of ms.items) {
    // follow a point that is fixed to the part itself, so the motion is an exact rigid rotation
    const q: Pt = [it.g.w / 2, it.g.h / 2];
    const w0 = tp(it.g, it.rot, q);
    const rx = w0[0] + it.x - cx;
    const ry = w0[1] + it.y - cy;
    const tx = cx + rx * co - ry * si;
    const ty = cy + rx * si + ry * co;
    it.rot = normAngle(it.rot + d);
    const w1 = tp(it.g, it.rot, q);
    it.x = tx - w1[0];
    it.y = ty - w1[1];
  }
  // one shared shift puts the block back on the optimiser's grid without changing the gaps inside it
  const f = ms.items[0];
  const sx = snapV(S, f.x) - f.x;
  const sy = snapV(S, f.y) - f.y;
  for (const it of ms.items) {
    it.x += sx;
    it.y += sy;
  }
  startGroupDrag(ms, S, dr.ptr); // keeps following the pointer from where it is now
}

// --------------------------------------------------------------------- drawing

export interface DrawExtras {
  /** Parts in the multi-selection (outlined in blue, or red while the block is in an invalid spot). */
  sel?: ReadonlySet<Item> | null;
  selBad?: boolean;
  /** Selection rectangle being dragged, in mm. `cross` = right-to-left (touch) selection, drawn green + dashed. */
  box?: { x0: number; y0: number; x1: number; y1: number; cross: boolean } | null;
}

export function drawSheet(sh: Sheet, cv: HTMLCanvasElement, k: number, S: Settings, selItem: Item | null, selBad = false, extra?: DrawExtras) {
  const c = cv.getContext("2d") as CanvasRenderingContext2D;
  const W = sh.W ?? S.W;
  const H = sh.H ?? S.H;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.setTransform(k, 0, 0, -k, 0, cv.height);
  c.lineWidth = 1 / k;
  c.strokeStyle = "#94a3b8";
  c.setLineDash([6 / k, 4 / k]);
  c.strokeRect(S.mg, S.mg, W - 2 * S.mg, H - 2 * S.mg);
  c.setLineDash([]);
  for (const it of sh.items) {
    c.fillStyle = selBad && selItem === it ? "#ef4444" : partColor(it.g);
    const P = path(it.g, it.rot, it.x, it.y);
    c.fill(P, "evenodd");
    c.globalAlpha = selItem === it ? 0.75 : 1;
    c.strokeStyle = selBad && selItem === it ? "#991b1b" : "#0008";
    c.lineWidth = 1 / k;
    c.stroke(P);
    c.globalAlpha = 1;
    if (extra?.sel?.has(it)) {
      c.strokeStyle = extra.selBad ? "#dc2626" : "#2563eb";
      c.lineWidth = 2.5 / k;
      c.stroke(P);
      c.lineWidth = 1 / k;
    }
  }
  const bx = extra?.box;
  if (bx) {
    // AutoCAD style: window (left → right) = blue solid, crossing (right → left) = green dashed
    const col = bx.cross ? "#16a34a" : "#2563eb";
    c.fillStyle = bx.cross ? "rgba(22,163,74,0.14)" : "rgba(37,99,235,0.14)";
    c.strokeStyle = col;
    c.lineWidth = 1.5 / k;
    c.setLineDash(bx.cross ? [6 / k, 4 / k] : []);
    c.fillRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
    c.strokeRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
    c.setLineDash([]);
    c.lineWidth = 1 / k;
  }
  // serial numbers on every part (drawn un-flipped so the text is readable)
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  for (const it of sh.items) {
    const b = bbox(sides(it).o);
    const m = Math.min(b[2] - b[0], b[3] - b[1]) * k;
    if (m < 16) continue;
    c.font = `bold ${Math.max(9, Math.min(16, m / 3))}px system-ui, Arial, sans-serif`;
    const x = ((b[0] + b[2]) / 2) * k;
    const y = cv.height - ((b[1] + b[3]) / 2) * k;
    const t = `#${it.g.sn}`;
    c.lineWidth = 3;
    c.strokeStyle = "#fff";
    c.strokeText(t, x, y);
    c.fillStyle = "#000";
    c.fillText(t, x, y);
  }
  c.restore();
}

export function sheetStats(sh: Sheet, S: Settings) {
  let a = 0;
  let mx = 0;
  for (const it of sh.items) {
    a += it.g.area;
    mx = Math.max(mx, bbox(sides(it).o)[2]);
  }
  const W = sh.W ?? S.W;
  const H = sh.H ?? S.H;
  return {
    parts: sh.items.reduce((s, x) => s + (x.g.n || 1), 0),
    usedLength: Math.round(mx + S.mg),
    utilization: (100 * a) / (W * H),
  };
}

// --------------------------------------------------------------------- problems

/** Explains why a part could not be nested. */
export function whyNotNested(g: Group, S: Settings): string {
  const uw = S.W - 2 * S.mg;
  const uh = S.H - 2 * S.mg;
  const R = rotList(S.ro);
  const fit = (rs: number[]) =>
    rs.some((r) => {
      const b = rotBox(g, r);
      return b.w <= uw && b.h <= uh;
    });
  const pr = (g.n || 1) > 1;
  const sz = `${pr ? "pair of triangles " : "part "}${g.w.toFixed(1)} × ${g.h.toFixed(1)} mm`;
  const us = `${uw} × ${uh} mm`;
  if (!fit(R)) {
    if (fit([0, 90]))
      return `${sz} does not fit the usable sheet area ${us} with the current rotation setting — enable "90° steps" rotation`;
    return (
      `${sz} is larger than the usable sheet area ${us} (sheet size minus edge margins) — use a bigger sheet or a smaller margin` +
      (pr ? ', or untick "Auto-pair triangles"' : "")
    );
  }
  return `no free position found (spacing ${S.gp} mm, grid cell ${S.cell} mm) — try a smaller grid cell or spacing`;
}

/** One message per un-nested part number. */
export function problemMessages(res: OptResult, S: Settings): string[] {
  const msgs = res.skip.slice();
  // manual nesting: leftovers are just "still to place" (shown in the parts table), not optimiser failures
  if (res.manual) return msgs;
  const mp = new Map<number, { g: Group; c: number }>();
  for (const g of res.un) {
    const q = mp.get(g.sn) || { g, c: 0 };
    q.c++;
    mp.set(g.sn, q);
  }
  mp.forEach(({ g, c }) =>
    msgs.push(`Part #${g.sn} (${g.name}) — ${c} pc${c > 1 ? "s" : ""} NOT nested: ${whyNotNested(g, S)}`),
  );
  return msgs;
}

// ----------------------------------------------------------------- DXF export

/**
 * Detects a ring that is really a full circle (a CIRCLE entity or a polyline
 * circle that was tessellated when the DXF was read). Returns its centre and
 * radius, or null for anything else. Circles survive every rotation, so this
 * can run on the already-transformed points.
 */
function fitCircle(pts: Pt[]): { c: Pt; r: number } | null {
  const n = pts.length;
  // A real polygon with few sides (hexagon, octagon...) must stay a polyline.
  if (n < 16) return null;
  // Least-squares (Kasa) fit: x^2 + y^2 + a*x + b*y + c = 0
  let sx = 0, sy = 0;
  for (const p of pts) {
    sx += p[0];
    sy += p[1];
  }
  const mx = sx / n;
  const my = sy / n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx;
    const v = p[1] - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const k1 = 0.5 * (suuu + suvv);
  const k2 = 0.5 * (svvv + svuu);
  const uc = (k1 * svv - k2 * suv) / det;
  const vc = (k2 * suu - k1 * suv) / det;
  const cx = uc + mx;
  const cy = vc + my;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  if (!(r > 0)) return null;
  const tol = Math.max(0.05, r * 0.001);
  for (const p of pts) if (Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) > tol) return null;
  // Points must go all the way round (no big empty arc such as a "D" shape).
  const ang = pts.map((p) => Math.atan2(p[1] - cy, p[0] - cx)).sort((a, b) => a - b);
  let gap = ang[0] + 2 * Math.PI - ang[n - 1];
  for (let i = 1; i < n; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
  if (gap > Math.PI / 6) return null;
  return { c: [cx, cy], r };
}

export function buildDxf(sheets: Sheet[], S: Settings): string {
  let s = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  const pl = (pts: Pt[], ox: number) => {
    // Round contours are written as true CIRCLE entities, not polylines.
    const ci = fitCircle(pts);
    if (ci) {
      s += `0\nCIRCLE\n8\n0\n10\n${(ci.c[0] + ox).toFixed(3)}\n20\n${ci.c[1].toFixed(3)}\n30\n0.0\n40\n${ci.r.toFixed(3)}\n`;
      return;
    }
    s += "0\nPOLYLINE\n8\n0\n66\n1\n70\n1\n";
    pts.forEach((p) => {
      s += `0\nVERTEX\n8\n0\n10\n${(p[0] + ox).toFixed(3)}\n20\n${p[1].toFixed(3)}\n`;
    });
    s += "0\nSEQEND\n8\n0\n";
  };
  let ox = 0;
  sheets.forEach((sh) => {
    const W = sh.W ?? S.W;
    const H = sh.H ?? S.H;
    pl([[0, 0], [W, 0], [W, H], [0, H]], ox);
    for (const it of sh.items)
      for (const r of [it.g.outer, ...it.g.holes, ...(it.g.extra || [])])
        pl(
          r.map((p) => {
            const q = tp(it.g, it.rot, p);
            return [q[0] + it.x, q[1] + it.y] as Pt;
          }),
          ox,
        );
    ox += W + 300;
  });
  s += "0\nENDSEC\n0\nEOF\n";
  return s;
}