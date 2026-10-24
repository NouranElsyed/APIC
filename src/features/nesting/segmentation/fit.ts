/**
 * Segmentation Phase 2 — does a part fit the configured source sheet?
 *
 * Reuses the engine's own rules (`rotList`, `rotBox`, `soloRot`, edge margin `mg`) so the
 * status here can never disagree with what `runOptimize` will do:
 *
 *   READY               fits inside the usable area (sheet minus edge margins) at a permitted rotation
 *   READY_SOLO          fits only the raw sheet → the engine already nests it alone with margin 0
 *   NEEDS_SEGMENTATION  fits neither → can be split into segments
 *   UNPLACEABLE         cannot be placed *or* segmented because of bad input / configuration
 *
 * The test is on the real part geometry rotated by each permitted angle (not on the unrotated
 * bounding box), so a part that fits after rotation is never rejected. Pure functions, no React.
 *
 * "Fits" means what the optimiser can really PLACE, not just the usable area: the engine rasterises
 * every part on a grid (cell size `cell`) after growing it by half the spacing `gp`, so the largest
 * piece it can put on a normal sheet is a little smaller than the usable area (`gridCapacity`).
 * A part between that limit and the usable area cannot be placed ("no free position found"), so it
 * is reported as NEEDS_SEGMENTATION with an explanation instead of READY.
 */
import { rotBox, rotList, soloRot, type Group, type Pt, type Settings } from "../nest-boost/engine";

export type FitStatus = "READY" | "READY_SOLO" | "NEEDS_SEGMENTATION" | "UNPLACEABLE";
export type UnplaceableReason = "INVALID_SHEET" | "INVALID_GEOMETRY" | "PAIRED_TRIANGLES";

export const FIT_LABEL: Record<FitStatus, string> = {
  READY: "READY FOR NESTING",
  READY_SOLO: "READY (SOLO SHEET)",
  NEEDS_SEGMENTATION: "NEEDS SEGMENTATION",
  UNPLACEABLE: "UNPLACEABLE",
};

export interface SheetSize {
  W: number;
  H: number;
}

/** Advice for a NEEDS_SEGMENTATION part that would fit whole under different rotation settings. */
export type FitHint =
  /** A rotation list the app already offers (ro 1–4) would fit it at `rot`. */
  | { kind: "ENABLE_ROTATION"; ro: number; rot: number; solo: boolean }
  /** Only an angle the rotation settings cannot produce fits it (sampled, ±0.25°). */
  | { kind: "ANY_ANGLE"; angle: number; solo: boolean };

export interface FitResult {
  status: FitStatus;
  label: string;
  /** One-line human explanation (safe to show as a tooltip). */
  detail: string;
  /** READY / READY_SOLO: the rotation (degrees) and the index into the `sheets` option that works. */
  rot?: number;
  sheetIndex?: number;
  reason?: UnplaceableReason;
  hint?: FitHint;
}

export interface FitOptions {
  /** Sheet sizes to test against. Default: the single stock size in `S` (what the nest uses today). */
  sheets?: SheetSize[];
}

/** Same slack the engine's `soloRot` allows. */
const TOL = 0.01;

/**
 * Largest size along one sheet dimension `len` that the optimiser can place on a normal (margined) sheet.
 * Derived from `cellsOf` / `makeSettings` in nest-boost/engine.ts: a part of size s covers
 * ⌈s/cell + g⌉ + ⌈g⌉ grid cells (g = gp / (2·cell)) and the grid has ⌊(len − 2·mg + gp)/cell⌋ cells.
 * Checked against the engine's own placement for several cell / spacing combinations (see tests).
 */
export function gridCapacity(len: number, mg: number, gp: number, cell: number): number {
  if (!(cell > 0)) return len - 2 * mg;
  const cells = Math.floor((len - 2 * mg + gp) / cell + 1e-9);
  const g = gp / (2 * cell);
  return (cells - Math.ceil(g - 1e-9)) * cell - gp / 2;
}
const fitsBox = (b: { w: number; h: number }, w: number, h: number) => b.w <= w + TOL && b.h <= h + TOL;
const mm = (v: number) => `${Math.round(v * 10) / 10}`;

export function rotLabel(ro: number): string {
  return ro === 0 ? "no rotation" : ro === 1 ? "0° / 180°" : ro === 2 ? "90° steps" : ro === 3 ? "45° steps" : "15° steps";
}

const unplaceable = (reason: UnplaceableReason, detail: string): FitResult => ({
  status: "UNPLACEABLE",
  label: FIT_LABEL.UNPLACEABLE,
  reason,
  detail,
});

/* ------------------------------------------------------------------ */
/* Hints                                                               */
/* ------------------------------------------------------------------ */

function convexHull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Bounding-box size of `pts` rotated CCW by `deg`. */
function rotatedSize(pts: Pt[], deg: number): { w: number; h: number } {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    const X = x * c - y * s;
    const Y = x * s + y * c;
    if (X < x0) x0 = X;
    if (X > x1) x1 = X;
    if (Y < y0) y0 = Y;
    if (Y > y1) y1 = Y;
  }
  return { w: x1 - x0, h: y1 - y0 };
}

function findHint(g: Group, S: Settings, sheets: SheetSize[]): FitHint | undefined {
  const mg = S.mg;
  const usableFit = (b: { w: number; h: number }) =>
    sheets.some((s) => fitsBox(b, gridCapacity(s.W, mg, S.gp, S.cell), gridCapacity(s.H, mg, S.gp, S.cell)));
  const rawFit = (b: { w: number; h: number }) => sheets.some((s) => fitsBox(b, s.W, s.H));
  const have = new Set(rotList(S.ro));

  // 1) a rotation setting the app already has (exact: same rotBox the engine uses)
  for (let ro = S.ro + 1; ro <= 4; ro++) {
    const extra = rotList(ro).filter((r) => !have.has(r));
    const u = extra.find((r) => usableFit(rotBox(g, r)));
    if (u !== undefined) return { kind: "ENABLE_ROTATION", ro, rot: u, solo: false };
    const s = extra.find((r) => rawFit(rotBox(g, r)));
    if (s !== undefined) return { kind: "ENABLE_ROTATION", ro, rot: s, solo: true };
  }

  // 2) any angle — sampled on the convex hull (the bounding box of a part equals that of its hull)
  const hull = convexHull([g.outer, ...(g.extra || [])].flat());
  if (hull.length < 3) return undefined;
  let solo: number | undefined;
  for (let a = 0; a < 180; a += 0.25) {
    const b = rotatedSize(hull, a);
    if (usableFit(b)) return { kind: "ANY_ANGLE", angle: a, solo: false };
    if (solo === undefined && rawFit(b)) solo = a;
  }
  return solo === undefined ? undefined : { kind: "ANY_ANGLE", angle: solo, solo: true };
}

function hintText(h: FitHint): string {
  const where = h.solo ? " (on a margin-free solo sheet)" : "";
  return h.kind === "ENABLE_ROTATION"
    ? `It would fit whole with "${rotLabel(h.ro)}" rotation, at ${h.rot}°${where} — segmentation would not be needed.`
    : `It would fit whole only at about ${Math.round(h.angle * 100) / 100}°${where}, an angle the rotation settings cannot produce.`;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** Classifies one part against the sheet(s) under the current nesting settings. */
export function classifyFit(g: Group, S: Settings, opts: FitOptions = {}): FitResult {
  const all = opts.sheets ?? [{ W: S.W, H: S.H }];
  const sheets = all.map((s, i) => ({ ...s, i })).filter((s) => Number.isFinite(s.W) && Number.isFinite(s.H) && s.W > 0 && s.H > 0);
  if (!sheets.length || !(S.mg >= 0)) {
    return unplaceable("INVALID_SHEET", "The source sheet size or edge margin is not valid.");
  }
  if (!(Number.isFinite(g.w) && Number.isFinite(g.h) && g.w > 0 && g.h > 0 && g.outer.length >= 3)) {
    return unplaceable("INVALID_GEOMETRY", "The part has no valid geometry (zero size or fewer than 3 points).");
  }

  const R = rotList(S.ro);
  let solo: FitResult | null = null;
  let nearLimit: { uw: number; uh: number; cw: number; ch: number } | null = null;
  for (const sh of sheets) {
    const uw = sh.W - 2 * S.mg;
    const uh = sh.H - 2 * S.mg;
    const cw = gridCapacity(sh.W, S.mg, S.gp, S.cell);
    const ch = gridCapacity(sh.H, S.mg, S.gp, S.cell);
    const rot = R.find((r) => fitsBox(rotBox(g, r), cw, ch));
    if (rot === undefined && !nearLimit && R.some((r) => fitsBox(rotBox(g, r), uw, uh))) nearLimit = { uw, uh, cw, ch };
    if (rot !== undefined) {
      return {
        status: "READY",
        label: FIT_LABEL.READY,
        rot,
        sheetIndex: sh.i,
        detail: `Fits the usable sheet area ${mm(uw)} × ${mm(uh)} mm (placeable up to ${mm(cw)} × ${mm(ch)}) at ${rot}°.`,
      };
    }
    if (!solo) {
      const sr = soloRot(g, { ...S, W: sh.W, H: sh.H }, R); // engine rule: fits the raw sheet, not the margins
      if (sr !== null) {
        solo = {
          status: "READY_SOLO",
          label: FIT_LABEL.READY_SOLO,
          rot: sr,
          sheetIndex: sh.i,
          detail: `Fits only the raw sheet ${mm(sh.W)} × ${mm(sh.H)} mm, not inside the ${mm(S.mg)} mm edge margins — nested alone on a margin-free sheet.`,
        };
      }
    }
  }
  if (solo) return solo;

  const sz = `${mm(g.w)} × ${mm(g.h)} mm`;
  const sheetTxt = sheets.map((s) => `${mm(s.W)} × ${mm(s.H)}`).join(" / ");
  if ((g.n || 1) > 1) {
    return unplaceable(
      "PAIRED_TRIANGLES",
      `Pair of triangles ${sz} does not fit ${sheetTxt} mm — untick "Auto-pair triangles" so they are nested (or segmented) one by one.`,
    );
  }
  if (nearLimit) {
    // inside the usable area but too big for the optimiser's grid: not placeable as it is
    return {
      status: "NEEDS_SEGMENTATION",
      label: FIT_LABEL.NEEDS_SEGMENTATION,
      detail:
        `${sz} fits the usable area ${mm(nearLimit.uw)} × ${mm(nearLimit.uh)} mm but not the optimiser's grid ` +
        `(largest placeable part ${mm(nearLimit.cw)} × ${mm(nearLimit.ch)} mm with spacing ${mm(S.gp)} mm and grid cell ${mm(S.cell)} mm). ` +
        `Lower the grid cell or spacing, or split it into segments.`,
    };
  }
  const hint = findHint(g, S, sheets.map(({ W, H }) => ({ W, H })));
  return {
    status: "NEEDS_SEGMENTATION",
    label: FIT_LABEL.NEEDS_SEGMENTATION,
    ...(hint ? { hint } : {}),
    detail:
      `${sz} does not fit ${sheetTxt} mm at any permitted rotation (${rotLabel(S.ro)}). It can be split into segments.` +
      (hint ? ` ${hintText(hint)}` : ""),
  };
}

/** Classifies every part. Keys are `Group.id`. */
export function classifyAll(groups: Group[], S: Settings, opts: FitOptions = {}): Map<number, FitResult> {
  return new Map(groups.map((g) => [g.id, classifyFit(g, S, opts)]));
}
