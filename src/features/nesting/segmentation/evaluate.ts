/**
 * Segmentation Phase 7 — evaluating a layout with the real nesting engine.
 *
 * The area-based "sheet lower bound" of a layout is only an estimate. Here the segments of a layout
 * are nested for real with `runOptimize` (the same engine, settings, spacing, grid and rotation the
 * nest uses), on their own, to get the actual number of sheets, utilization and scrap.
 *
 * Limits (also shown to the user):
 *  - the layout is nested ALONE, not mixed with the other parts of the nest;
 *  - the engine is randomised and runs for a short time budget per layout, so in close cases another
 *    run can differ by a sheet;
 *  - quantity matters: the pieces are nested × the original's quantity, exactly as after approval.
 */
import { makeSettings, runOptimize, type Group, type OptResult, type Settings } from "../nest-boost/engine";
import { regionToGroupShape } from "./convert";
import type { SheetSize } from "./fit";
import type { Plan } from "./planner";

export interface EngineCtx {
  /** The nest's edge margin, spacing, grid cell and rotation setting. */
  mg: number;
  gp: number;
  cell: number;
  ro: number;
  /** The nest's "pair triangles" / "common cut" options. */
  pair: boolean;
  common: boolean;
  /** Time budget per layout, seconds. */
  timeSec: number;
}

export interface EngineEval {
  /** Sheets the engine needed. */
  sheets: number;
  /** Of which one-piece margin-free ("solo") sheets. */
  soloSheets: number;
  /** Pieces placed / pieces the engine could not place. */
  pieces: number;
  unplaced: number;
  /** Percent of the sheets' area covered by pieces / left over. */
  utilization: number;
  scrapPct: number;
  sheetAreaM2: number;
  partsAreaM2: number;
  /** The sheet size the layout was nested on. */
  sheet: SheetSize;
  /** Wall-clock seconds the run took. */
  seconds: number;
}

/** The segments of a plan as temporary nestable parts (ids 1..n), quantity = the original's (at least 1). */
export function piecesFor(plan: Plan, part: Pick<Group, "qty" | "th" | "material">, tol = 0.1): Group[] {
  const qty = Math.max(1, Math.round(Number.isFinite(part.qty) ? part.qty : 1));
  return plan.segments.map((s, i) => {
    const sh = regionToGroupShape(s.cut, tol);
    return {
      id: i + 1,
      sn: i + 1,
      name: s.id,
      qty,
      th: part.th,
      material: part.material,
      outer: sh.outer,
      holes: sh.holes,
      w: sh.w,
      h: sh.h,
      area: sh.area,
      per: sh.per,
    };
  });
}

/** Sheets / utilization of an engine result (same formulas as `nestMetrics` in saved-nests.tsx). */
export function measure(res: OptResult, S: Settings): Pick<EngineEval, "sheets" | "soloSheets" | "pieces" | "unplaced" | "utilization" | "scrapPct" | "sheetAreaM2" | "partsAreaM2"> {
  let sheetArea = 0;
  let partsArea = 0;
  let pieces = 0;
  for (const sh of res.sheets) {
    sheetArea += (sh.W ?? S.W) * (sh.H ?? S.H);
    partsArea += sh.items.reduce((s, it) => s + it.g.area, 0);
    pieces += sh.items.reduce((s, it) => s + (it.g.n || 1), 0);
  }
  const scrap = Math.max(0, sheetArea - partsArea);
  return {
    sheets: res.sheets.length,
    soloSheets: res.sheets.filter((s) => s.solo).length,
    pieces,
    unplaced: res.un.length,
    utilization: sheetArea ? (100 * partsArea) / sheetArea : 0,
    scrapPct: sheetArea ? (100 * scrap) / sheetArea : 0,
    sheetAreaM2: sheetArea / 1e6,
    partsAreaM2: partsArea / 1e6,
  };
}

export interface EvalHooks {
  /** Return true to abandon the run (the result is then discarded and `null` returned). */
  shouldStop?: () => boolean;
  /** Replace the engine (tests). */
  run?: typeof runOptimize;
}

/**
 * Nests a plan's pieces on `sheet` with the real engine. Returns null for an invalid / empty plan or when
 * stopped. A layout whose pieces the engine cannot all place has `unplaced > 0`.
 */
export async function evaluatePlan(
  plan: Plan,
  part: Pick<Group, "qty" | "th" | "material">,
  sheet: SheetSize,
  ctx: EngineCtx,
  hooks: EvalHooks = {},
): Promise<EngineEval | null> {
  if (!plan.valid || !plan.segments.length) return null;
  const S = makeSettings({ W: sheet.W, H: sheet.H, mg: ctx.mg, gp: ctx.gp, cell: ctx.cell, ro: ctx.ro });
  const t0 = Date.now();
  const stop = hooks.shouldStop ?? (() => false);
  const res = await (hooks.run ?? runOptimize)(piecesFor(plan, part), {
    S,
    pair: ctx.pair,
    common: ctx.common,
    timeSec: ctx.timeSec,
    base: null,
    shouldStop: stop,
    onBest: () => {},
    onStatus: () => {},
  });
  if (!res || stop()) return null;
  return { ...measure(res, S), sheet: { W: sheet.W, H: sheet.H }, seconds: (Date.now() - t0) / 1000 };
}
