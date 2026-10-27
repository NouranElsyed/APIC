/**
 * Segmentation Phase 3 — planner.
 *
 * Two layers:
 *  - `buildPlan(region, input)`: the exact, deterministic constructor. Given explicit cut
 *    lines it produces numbered segments (finished + cut geometry), the seams between them,
 *    metrics and validation issues. The editor (Phase 5) edits the cut lists and calls this.
 *  - `generateCandidates(region, settings)`: proposes cut lists (strips + transverse seams,
 *    staggered, hole-avoiding) for each direction / sheet / limit mode and builds a plan for each.
 *
 * Cut model (two-level guillotine): parallel STRIP cuts across the part, then TRANSVERSE seam
 * cuts inside a strip. Direction "H" = horizontal strips (cut lines y = const, seams x = const);
 * "V" = vertical strips (cut lines x = const, seams y = const).
 *
 * FREE CUTS (optional): the user can also draw free-form cut lines (polylines). They are applied after the
 * strips and seams, to every cell, and split the pieces along the drawn line. Pieces are then numbered one
 * by one (S01, S02, …). Overlap / gap is not supported together with free cuts (reported as an error).
 *
 * Geometry kinds kept apart on every segment:
 *   finished — the exact piece of the original outline (pieces reassemble to the part)
 *   cut      — what is cut from sheet. Equal to `finished` unless overlap is enabled.
 * Kerf, root gap, trim etc. are NOT modelled here (out of scope for this phase).
 *
 * OVERLAP / GAP (optional, off by default), one signed value `mm`:
 *   mm > 0  OVERLAP — the pieces are welded on top of each other: at a seam one side extends by `mm`
 *           into its neighbour. The extension is the original material inside the extended box of the
 *           cell, so it never leaves the original outline (at a corner where two extensions meet, the
 *           corner square is included).
 *   mm < 0  GAP — a gap of |mm| is left between the pieces: at a seam the carrier side is cut back
 *           by |mm|. The finished pieces still reassemble to the part; the gap is a cutting allowance.
 * Which side moves: policy "A" = the lower-coordinate side (by the full amount), "alternate" =
 * alternating by cut index, "symmetric" = both sides by |mm|/2. Finished geometry, takeoff area and
 * seam lengths ignore it; fit validation, material estimates and the pieces made on approval use
 * the cut geometry.
 */
import { makeSettings, rotList, type Group } from "../nest-boost/engine";
import { regionToGroupShape } from "./convert";
import { classifyFit, gridCapacity, type FitResult, type SheetSize } from "./fit";
import {
  FREE_MIN_SEGMENT,
  radialRays,
  radialValid,
  rayHolesEntered,
  splitRegionsRadial,
  type RadialSpec,
  distanceToPath,
  extendPath,
  pathLength,
  pathSelfIntersects,
  sharedSegments,
  splitRegionsByPath,
} from "./free-cut";
import {
  MIN_CUT_SPACING,
  clipRegionToBox,
  edgesOnLine,
  loopBBox,
  normalizeRegion,
  regionArea,
  regionBBox,
  regionContains,
  regionInteriorPoint,
  sliceRegions,
  type Box,
} from "./geometry";
import type { Axis, CutRecord, Pt, Region } from "./types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Direction = "H" | "V";
export type HolePolicy = "reject" | "warn";
export type OverlapSide = "A" | "alternate" | "symmetric";

export interface OverlapSpec {
  enabled: boolean;
  /**
   * Signed width at a joint, mm: positive = the pieces overlap (welded on top of each other), negative = a gap
   * of that size between them. Required (non-zero) when enabled — there is no default.
   */
  mm: number;
  side: OverlapSide;
}

/** Sheet context: user-defined sources, the nest's edge margin and rotation setting. */
export interface SheetCtx {
  sheets: SheetSize[];
  mg: number;
  ro: number;
  /**
   * The nest's part spacing and grid cell (mm). The optimiser can only place parts up to `gridCapacity`
   * (a little less than the usable area), so segments are sized to that. Leave both out to size to the
   * plain usable area (sheet minus margins).
   */
  gp?: number;
  cell?: number;
}

/** All optional: a missing value means "not enforced" (no defaults are assumed). */
export interface SeamConstraints {
  /** Min distance between transverse seams of adjacent strips. */
  minSeamStagger?: number;
  /** Min extent of the segments on both sides of a seam, measured across the seam. */
  minSeamToBoundary?: number;
  /** Max length of one seam between two segments. */
  maxSeamLength?: number;
  /** Forbid transverse seams of adjacent strips meeting at the same position. */
  forbidCrossJunctions?: boolean;
  /** Smallest allowed bounding-box side of a segment. */
  minSegmentMm?: number;
}

export interface StripCut {
  id: string;
  pos: number;
}
export interface SeamCut {
  id: string;
  /** Index of the strip (0 = lowest coordinate) this transverse cut is in. */
  strip: number;
  pos: number;
}

/** A free-form cut line: an open polyline in world coordinates (mm). Its ends are extended to the part's edge. */
export interface FreeCut {
  id: string;
  pts: Pt[];
}

/** Radial cut: `count` equal sectors around `center`, the first cut line pointing `startDeg` degrees from +x. */
export type RadialCut = RadialSpec;

export interface PlanInput {
  direction: Direction;
  stripCuts: StripCut[];
  seamCuts: SeamCut[];
  /** Hand-drawn cut lines (optional; absent in plans saved before this tool existed). */
  freeCuts?: FreeCut[];
  /** Radial (pie-slice) cut around a centre point (optional). */
  radial?: RadialCut;
  overlap: OverlapSpec;
  sheet: SheetCtx;
  holePolicy: HolePolicy;
  /** Cut ids the user has explicitly accepted to cut through a hole (policy "warn"). */
  confirmedHoleCuts?: string[];
  constraints?: SeamConstraints;
  /** Arc tessellation tolerance for fit checks, mm (default 0.1). */
  tol?: number;
}

export type IssueCode =
  | "INVALID_OVERLAP"
  | "BAD_CUT"
  | "FREE_CUT_OVERLAP"
  | "CUT_OUTSIDE_PART"
  | "CUT_SHIFTED"
  | "HOLE_CUT"
  | "HOLE_CUT_UNCONFIRMED"
  | "SEGMENT_TOO_LARGE"
  | "SEGMENT_UNPLACEABLE"
  | "SEGMENT_SOLO"
  | "SEGMENT_TOO_SMALL"
  | "SEAM_STAGGER"
  | "CROSS_JUNCTION"
  | "SEAM_TOO_LONG"
  | "SEAM_NEAR_BOUNDARY"
  | "OVERLAP_MERGES_PIECES"
  | "GAP_TOO_LARGE"
  | "GAP_SPLITS_PIECE";

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning" | "info";
  message: string;
  cutId?: string;
  segmentId?: string;
}

export interface Segment {
  /** "S01", or "S02a"/"S02b" when one cell yields several disconnected pieces. */
  id: string;
  cell: { strip: number; index: number };
  finished: Region;
  cut: Region;
  finishedArea: number;
  cutArea: number;
  /** Bounding box of the cut geometry [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  fit: FitResult;
  solo: boolean;
}

export interface PlanSeam {
  /** `${cutId}:${lowSegment}|${highSegment}` */
  id: string;
  cutId: string;
  kind: "strip" | "transverse" | "free";
  /** The cut line is `axis = pos`. (Free cuts: axis "x" / pos 0 are placeholders, see `path`.) */
  axis: Axis;
  pos: number;
  low: string;
  high: string;
  length: number;
  intervals: [number, number][];
  /** Which side carries the overlap / gap here, or null when it is off. */
  carrier: "low" | "high" | "both" | null;
  /** Free cuts only: the seam as straight segments in world coordinates. */
  path?: [Pt, Pt][];
}

export interface PlanMetrics {
  segments: number;
  cuts: number;
  /** Total seam length (the length that has to be joined). */
  cutLength: number;
  finishedArea: number;
  cutArea: number;
  /** Cut area minus finished area: positive with an overlap, negative with a gap. */
  overlapArea: number;
  soloSegments: number;
  unfitSegments: number;
  /** Area-based lower bound only; the real count comes from running the nesting engine. */
  sheetsLowerBound: number | null;
}

export interface Plan {
  input: PlanInput;
  segments: Segment[];
  seams: PlanSeam[];
  issues: Issue[];
  /** True when there is no error-level issue. */
  valid: boolean;
  metrics: PlanMetrics;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TOL_MM = 0.1;
const pad = (n: number) => String(n).padStart(2, "0");
const letter = (i: number) => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
const r2 = (v: number) => Math.round(v * 100) / 100;

const carrierOf = (side: OverlapSide, idx: number): "low" | "high" | "both" =>
  side === "A" ? "low" : side === "symmetric" ? "both" : idx % 2 === 0 ? "low" : "high";

const boxFor = (axis: Axis, lo: number, hi: number): Box => (axis === "x" ? { x0: lo, x1: hi } : { y0: lo, y1: hi });

function intersectIntervals(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi - lo > 1e-6) out.push([lo, hi]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* buildPlan                                                           */
/* ------------------------------------------------------------------ */

export function buildPlan(regionIn: Region, input: PlanInput): Plan {
  const region = normalizeRegion(regionIn);
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], code: IssueCode, message: string, extra: Partial<Issue> = {}) =>
    issues.push({ severity, code, message, ...extra });
  const cons = input.constraints ?? {};
  const tol = input.tol ?? TOL_MM;
  const freeCuts = input.freeCuts ?? [];
  const radial = input.radial;
  const hasFree = freeCuts.length > 0 || !!radial;
  // free cuts do not support overlap / gap: it is switched off for the geometry and reported as an error below
  const o = !hasFree && input.overlap.enabled ? input.overlap.mm : 0; // signed: > 0 overlap, < 0 gap
  const w = Math.abs(o);
  const isGap = o < 0;

  const finish = (segments: Segment[], seams: PlanSeam[]): Plan => {
    const solo = segments.filter((s) => s.solo);
    const usable = Math.max(
      0,
      ...input.sheet.sheets.map((s) => Math.max(0, s.W - 2 * input.sheet.mg) * Math.max(0, s.H - 2 * input.sheet.mg)),
    );
    const cutArea = segments.reduce((s, g) => s + g.cutArea, 0);
    const nonSolo = segments.filter((s) => !s.solo).reduce((s, g) => s + g.cutArea, 0);
    return {
      input,
      segments,
      seams,
      issues,
      valid: !issues.some((i) => i.severity === "error"),
      metrics: {
        segments: segments.length,
        cuts: input.stripCuts.length + input.seamCuts.length + freeCuts.length + (radial ? radial.count : 0),
        cutLength: seams.reduce((s, m) => s + m.length, 0),
        finishedArea: segments.reduce((s, g) => s + g.finishedArea, 0),
        cutArea,
        overlapArea: cutArea - segments.reduce((s, g) => s + g.finishedArea, 0),
        soloSegments: solo.length,
        unfitSegments: segments.filter((s) => s.fit.status === "NEEDS_SEGMENTATION" || s.fit.status === "UNPLACEABLE").length,
        sheetsLowerBound: usable > 0 ? solo.length + Math.ceil(nonSolo / usable - 1e-9) : null,
      },
    };
  };

  if (input.overlap.enabled && !(Number.isFinite(input.overlap.mm) && input.overlap.mm !== 0)) {
    add("error", "INVALID_OVERLAP", "Overlap is enabled but its value is missing or zero. Enter a positive value to overlap the pieces or a negative value for a gap between them.");
    return finish([], []);
  }

  if (hasFree && input.overlap.enabled) {
    add("error", "FREE_CUT_OVERLAP", "Overlap / gap cannot be used together with free-form cuts yet. Turn the overlap off or remove the free cuts.");
  }

  const acrossAxis: Axis = input.direction === "H" ? "y" : "x";
  const alongAxis: Axis = input.direction === "H" ? "x" : "y";
  const stripCuts = [...input.stripCuts].sort((a, b) => a.pos - b.pos);
  const nStrips = stripCuts.length + 1;

  const spacingOk = (cuts: { id: string; pos: number }[]) => {
    for (let i = 0; i < cuts.length; i++) {
      if (!Number.isFinite(cuts[i].pos)) {
        add("error", "BAD_CUT", `Cut ${cuts[i].id} has no valid position.`, { cutId: cuts[i].id });
        return false;
      }
      if (i > 0 && !(cuts[i].pos - cuts[i - 1].pos >= MIN_CUT_SPACING)) {
        add("error", "BAD_CUT", `Cuts ${cuts[i - 1].id} and ${cuts[i].id} are on the same position.`, { cutId: cuts[i].id });
        return false;
      }
    }
    return true;
  };
  if (!spacingOk(stripCuts)) return finish([], []);

  const seamByStrip: SeamCut[][] = Array.from({ length: nStrips }, () => []);
  for (const sc of input.seamCuts) {
    if (!Number.isInteger(sc.strip) || sc.strip < 0 || sc.strip >= nStrips) {
      add("error", "BAD_CUT", `Seam cut ${sc.id} refers to a strip that does not exist.`, { cutId: sc.id });
      return finish([], []);
    }
    seamByStrip[sc.strip].push(sc);
  }
  for (const list of seamByStrip) {
    list.sort((a, b) => a.pos - b.pos);
    if (!spacingOk(list)) return finish([], []);
  }

  /* ---- exact cutting ------------------------------------------------ */
  const sl = sliceRegions([region], acrossAxis, stripCuts.map((c) => c.pos));
  const usedAcross = sl.cuts.map((c) => c.usedPos);
  const confirmed = new Set(input.confirmedHoleCuts ?? []);

  const checkCut = (cutId: string, rec: CutRecord, where: string) => {
    if (rec.shifted) {
      add("info", "CUT_SHIFTED", `Cut ${cutId} ${where} passed through a vertex or edge and was moved by ${r2((rec.usedPos - rec.requestedPos) * 1000) / 1000} mm.`, { cutId });
    }
    if (rec.seamLength <= 1e-9) {
      add("error", "CUT_OUTSIDE_PART", `Cut ${cutId} ${where} does not cross any material.`, { cutId });
      return;
    }
    if (rec.holesCrossed.length) {
      const n = rec.holesCrossed.length;
      const msg = `Cut ${cutId} ${where} crosses ${n} hole${n > 1 ? "s" : ""}.`;
      if (input.holePolicy === "reject") add("error", "HOLE_CUT", `${msg} Cutting through holes is not allowed.`, { cutId });
      else if (confirmed.has(cutId)) add("warning", "HOLE_CUT", `${msg} Accepted by the user.`, { cutId });
      else add("error", "HOLE_CUT_UNCONFIRMED", `${msg} Confirm it to keep this cut.`, { cutId });
    }
  };
  stripCuts.forEach((c, i) => checkCut(c.id, sl.cuts[i], `at ${acrossAxis} = ${r2(sl.cuts[i].requestedPos)}`));

  const cells: Region[][][] = []; // [strip][cell] -> pieces
  const usedAlong: number[][] = [];
  seamByStrip.forEach((list, s) => {
    if (!list.length) {
      cells.push([sl.strips[s]]);
      usedAlong.push([]);
      return;
    }
    const sub = sliceRegions(sl.strips[s], alongAxis, list.map((c) => c.pos));
    cells.push(sub.strips);
    usedAlong.push(sub.cuts.map((c) => c.usedPos));
    list.forEach((c, j) => checkCut(c.id, sub.cuts[j], `at ${alongAxis} = ${r2(c.pos)} in strip ${s + 1}`));
  });

  /* ---- free-form cuts ---------------------------------------------------- */
  // Applied to every cell, one cut after the other. A cut is first extended past both ends so it always runs out
  // through the edge of the part; the planner reports (and skips) a line that crosses itself.
  const freeUsed: { id: string; pts: Pt[] }[] = [];
  if (hasFree) {
    const [rx0, ry0, rx1, ry1] = regionBBox(region);
    const cx0 = radial && radialValid(radial) ? radial.center : [(rx0 + rx1) / 2, (ry0 + ry1) / 2];
    const reach = 2 * Math.hypot(rx1 - rx0, ry1 - ry0) + Math.hypot(cx0[0] - (rx0 + rx1) / 2, cx0[1] - (ry0 + ry1) / 2) + 10;
    let placed = cells.flatMap((row, s) => row.flatMap((pieces, k) => pieces.map((reg) => ({ s, k, reg, sector: 0 }))));

    if (radial) {
      if (!radialValid(radial)) {
        add("error", "BAD_CUT", "The radial cut needs a centre point, 2 to 72 divisions and a start angle.", { cutId: "R1" });
      } else {
        try {
          const res = splitRegionsRadial(placed.map((p) => p.reg), radial, reach);
          const next: typeof placed = [];
          res.parts.forEach((part, i) => part.pieces.forEach((reg, j) => next.push({ ...placed[i], reg, sector: part.sectors[j] })));
          const changed = next.length > placed.length;
          placed = next;
          const rays = radialRays({ ...radial, center: res.center }, reach);
          rays.forEach((ray) => {
            freeUsed.push({ id: ray.id, pts: [ray.a, ray.b] });
            const holes = rayHolesEntered(region, ray);
            checkCut(ray.id, { requestedPos: 0, usedPos: 0, shifted: false, seams: [], seamLength: 1, holesCrossed: holes }, "(radial)");
          });
          if (!changed) add("error", "CUT_OUTSIDE_PART", "The radial cut does not cross any material: move the centre onto the part.", { cutId: "R1" });
          if (res.shifted) add("info", "CUT_SHIFTED", "A radial cut line passed through a vertex or edge and was moved by a tiny step (0.0001 mm).", { cutId: "R1" });
        } catch (e) {
          add("error", "BAD_CUT", `The radial cut could not be applied: ${e instanceof Error ? e.message.replace(/^segmentation: /, "") : "unknown error"}.`, { cutId: "R1" });
        }
      }
    }
    for (const fc of freeCuts) {
      const pts = (fc.pts ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length < 2 || pathLength(pts) < FREE_MIN_SEGMENT) {
        add("error", "BAD_CUT", `Free cut ${fc.id} needs at least two different points.`, { cutId: fc.id });
        continue;
      }
      const path = extendPath(pts, reach);
      if (pathSelfIntersects(path)) {
        add("error", "BAD_CUT", `Free cut ${fc.id} crosses itself (or its straight extension to the edge does). Redraw it as a line that does not cross itself.`, { cutId: fc.id });
        continue;
      }
      let res;
      try {
        res = splitRegionsByPath(placed.map((p) => p.reg), path);
      } catch (e) {
        add("error", "BAD_CUT", `Free cut ${fc.id} could not be applied: ${e instanceof Error ? e.message.replace(/^segmentation: /, "") : "unknown error"}.`, { cutId: fc.id });
        continue;
      }
      const next: typeof placed = [];
      res.parts.forEach((part, i) => part.pieces.forEach((reg) => next.push({ ...placed[i], reg })));
      placed = next;
      freeUsed.push({ id: fc.id, pts: res.usedPath });
      const seamLength = res.parts.reduce((t, p) => t + p.seamLength, 0);
      const holes = res.parts.flatMap((p) => p.holesCrossed);
      if (res.shifted) add("info", "CUT_SHIFTED", `Free cut ${fc.id} passed through a vertex or edge and was moved by a tiny step (0.0001 mm).`, { cutId: fc.id });
      checkCut(fc.id, { requestedPos: 0, usedPos: 0, shifted: false, seams: [], seamLength, holesCrossed: holes }, "(free-form)");
    }
    cells.forEach((row, s) =>
      row.forEach((_, k) => {
        row[k] = placed
          .filter((p) => p.s === s && p.k === k)
          .sort((a, b) => {
            const ba = loopBBox(a.reg.outer);
            const bb = loopBBox(b.reg.outer);
            return a.sector - b.sector || ba[1] - bb[1] || ba[0] - bb[0];
          })
          .map((p) => p.reg);
      }),
    );
  }

  /* ---- segments ------------------------------------------------------ */
  const amt = (c: "low" | "high" | "both") => (c === "both" ? w / 2 : w);
  const side = input.overlap.side;
  const S0 = makeSettings({
    W: input.sheet.sheets[0]?.W ?? 0,
    H: input.sheet.sheets[0]?.H ?? 0,
    mg: input.sheet.mg,
    gp: input.sheet.gp ?? 0,
    cell: input.sheet.cell ?? 1, // without a cell size the check is the plain usable area (1 mm grid ≈ no rounding)
    ro: input.sheet.ro,
  });

  const segments: Segment[] = [];
  let counter = 0;
  for (let s = 0; s < nStrips; s++) {
    const m = usedAlong[s].length;
    for (let k = 0; k <= m; k++) {
      const pieces = cells[s][k];
      if (!pieces.length) continue;
      counter++; // with free cuts every piece gets its own number, starting here

      // overlap / gap: how far each side of this cell moves (out for an overlap, in for a gap)
      let eAL = 0;
      let eAH = 0;
      let eLL = 0;
      let eLH = 0;
      if (o !== 0) {
        if (s > 0 && carrierOf(side, s - 1) !== "low") eAL = amt(carrierOf(side, s - 1));
        if (s < nStrips - 1 && carrierOf(side, s) !== "high") eAH = amt(carrierOf(side, s));
        if (k > 0 && carrierOf(side, k - 1) !== "low") eLL = amt(carrierOf(side, k - 1));
        if (k < m && carrierOf(side, k) !== "high") eLH = amt(carrierOf(side, k));
      }
      let cutRegions: (Region | null)[] = pieces.map(() => null);
      if (isGap && (eAL || eAH || eLL || eLH)) {
        // GAP: cut each piece back from the seam, working on the finished piece itself
        const aLo = (s > 0 ? usedAcross[s - 1] : -Infinity) + eAL;
        const aHi = (s < nStrips - 1 ? usedAcross[s] : Infinity) - eAH;
        const lLo = (k > 0 ? usedAlong[s][k - 1] : -Infinity) + eLL;
        const lHi = (k < m ? usedAlong[s][k] : Infinity) - eLH;
        cutRegions = pieces.map((piece, pi) => {
          const across = clipRegionToBox(piece, boxFor(acrossAxis, aLo, aHi));
          const comps = across.pieces.flatMap((p) => clipRegionToBox(p, boxFor(alongAxis, lLo, lHi)).pieces);
          const sid = pieces.length > 1 ? `S${pad(counter)}${letter(pi)}` : `S${pad(counter)}`;
          if (!comps.length) {
            add("error", "GAP_TOO_LARGE", `A gap of ${r2(w)} mm leaves nothing of segment ${sid} (it is narrower than the gap).`, { segmentId: sid });
            return null; // keeps the finished shape so the plan can still be drawn; it is invalid anyway
          }
          if (comps.length > 1) {
            add("warning", "GAP_SPLITS_PIECE", `The gap cuts segment ${sid} into ${comps.length} parts; only the largest is kept.`, { segmentId: sid });
            return comps.reduce((b, c) => (regionArea(c) > regionArea(b) ? c : b));
          }
          return comps[0];
        });
      } else if (eAL || eAH || eLL || eLH) {
        // OVERLAP: original material inside the extended box of the cell
        const aLo = (s > 0 ? usedAcross[s - 1] : -Infinity) - eAL;
        const aHi = (s < nStrips - 1 ? usedAcross[s] : Infinity) + eAH;
        const lLo = (k > 0 ? usedAlong[s][k - 1] : -Infinity) - eLL;
        const lHi = (k < m ? usedAlong[s][k] : Infinity) + eLH;
        const across = clipRegionToBox(region, boxFor(acrossAxis, aLo, aHi));
        let shifted = across.shifted;
        const comps = across.pieces.flatMap((p) => {
          const c = clipRegionToBox(p, boxFor(alongAxis, lLo, lHi));
          shifted = shifted || c.shifted;
          return c.pieces;
        });
        if (shifted) add("info", "CUT_SHIFTED", `An overlap boundary of segment cell ${pad(counter)} was moved by 0.0001 mm (degenerate position).`);
        const claims = new Map<Region, number>();
        const match = pieces.map((piece) => {
          const pt = regionInteriorPoint(piece);
          const hits = pt ? comps.filter((c) => regionContains(c, pt)) : [];
          const hit = hits.length === 1 ? hits[0] : null;
          if (hit) claims.set(hit, (claims.get(hit) ?? 0) + 1);
          return hit;
        });
        cutRegions = match.map((hit) => (hit && claims.get(hit) === 1 ? hit : null));
        if (match.some((hit) => hit && (claims.get(hit) ?? 0) > 1)) {
          add("warning", "OVERLAP_MERGES_PIECES", `Overlap would join the separate pieces of segment ${pad(counter)}; they keep their finished shape without overlap.`);
        }
      }

      pieces.forEach((piece, pi) => {
        const id = hasFree ? `S${pad(counter + pi)}` : pieces.length > 1 ? `S${pad(counter)}${letter(pi)}` : `S${pad(counter)}`;
        const cut = cutRegions[pi] ?? piece;
        const shape = regionToGroupShape(cut, tol);
        const g: Group = {
          id: 0, sn: 0, name: id, qty: 1, th: 0, material: "",
          outer: shape.outer, holes: shape.holes, w: shape.w, h: shape.h, area: shape.area, per: shape.per,
        };
        const fit = classifyFit(g, S0, { sheets: input.sheet.sheets });
        const solo = fit.status === "READY_SOLO";
        if (fit.status === "NEEDS_SEGMENTATION") {
          add("error", "SEGMENT_TOO_LARGE", `Segment ${id} (${r2(shape.w)} × ${r2(shape.h)} mm) does not fit the source sheet. ${fit.detail}`, { segmentId: id });
        } else if (fit.status === "UNPLACEABLE") {
          add("error", "SEGMENT_UNPLACEABLE", `Segment ${id} cannot be placed: ${fit.detail}`, { segmentId: id });
        } else if (solo) {
          add("info", "SEGMENT_SOLO", `Segment ${id} needs a margin-free sheet of its own.`, { segmentId: id });
        }
        const fb = loopBBox(piece.outer);
        if (cons.minSegmentMm !== undefined && Math.min(fb[2] - fb[0], fb[3] - fb[1]) < cons.minSegmentMm) {
          add("error", "SEGMENT_TOO_SMALL", `Segment ${id} is narrower than ${cons.minSegmentMm} mm.`, { segmentId: id });
        }
        segments.push({
          id, cell: { strip: s, index: k }, finished: piece, cut,
          finishedArea: regionArea(piece), cutArea: regionArea(cut), bbox: loopBBox(cut.outer), fit, solo,
        });
      });
      if (hasFree) counter += pieces.length - 1;
    }
  }

  /* ---- seams (which segments meet across each cut) -------------------- */
  const seams: PlanSeam[] = [];
  const seamsFor = (cutId: string, kind: PlanSeam["kind"], axis: Axis, pos: number, carrier: PlanSeam["carrier"], lowSegs: Segment[], highSegs: Segment[]) => {
    for (const a of lowSegs) {
      const ia = edgesOnLine(a.finished, axis, pos);
      if (!ia.length) continue;
      for (const b of highSegs) {
        const iv = intersectIntervals(ia, edgesOnLine(b.finished, axis, pos));
        const length = iv.reduce((t, [lo, hi]) => t + (hi - lo), 0);
        if (length > 1e-6) seams.push({ id: `${cutId}:${a.id}|${b.id}`, cutId, kind, axis, pos, low: a.id, high: b.id, length, intervals: iv, carrier });
      }
    }
  };
  stripCuts.forEach((c, i) =>
    seamsFor(c.id, "strip", acrossAxis, usedAcross[i], o !== 0 ? carrierOf(side, i) : null,
      segments.filter((g) => g.cell.strip === i), segments.filter((g) => g.cell.strip === i + 1)),
  );
  seamByStrip.forEach((list, s) =>
    list.forEach((c, j) =>
      seamsFor(c.id, "transverse", alongAxis, usedAlong[s][j], o !== 0 ? carrierOf(side, j) : null,
        segments.filter((g) => g.cell.strip === s && g.cell.index === j), segments.filter((g) => g.cell.strip === s && g.cell.index === j + 1)),
    ),
  );

  // seams of free cuts: the boundary two pieces of one cell share along a drawn line
  if (hasFree) {
    for (let s = 0; s < nStrips; s++) {
      for (let k = 0; k < cells[s].length; k++) {
        const here = segments.filter((g) => g.cell.strip === s && g.cell.index === k);
        for (let i = 0; i < here.length; i++) {
          for (let j = i + 1; j < here.length; j++) {
            const byCut = new Map<string, [Pt, Pt][]>();
            for (const seg of sharedSegments(here[i].finished, here[j].finished)) {
              const mid: Pt = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2];
              const owner = freeUsed.find((f) => distanceToPath(f.pts, mid) < 1e-3);
              if (!owner) continue;
              byCut.set(owner.id, [...(byCut.get(owner.id) ?? []), seg]);
            }
            for (const [cutId, path] of byCut) {
              const length = path.reduce((t, [p, q]) => t + Math.hypot(q[0] - p[0], q[1] - p[1]), 0);
              if (length > 1e-6) {
                seams.push({ id: `${cutId}:${here[i].id}|${here[j].id}`, cutId, kind: "free", axis: "x", pos: 0, low: here[i].id, high: here[j].id, length, intervals: [], carrier: null, path });
              }
            }
          }
        }
      }
    }
  }

  /* ---- seam constraints ------------------------------------------------ */
  const segBy = new Map(segments.map((g) => [g.id, g]));
  for (const m of seams) {
    if (cons.maxSeamLength !== undefined && m.length > cons.maxSeamLength) {
      add("error", "SEAM_TOO_LONG", `Seam ${m.low}|${m.high} is ${r2(m.length)} mm long (max ${cons.maxSeamLength}).`, { cutId: m.cutId });
    }
    if (cons.minSeamToBoundary !== undefined && m.kind !== "free") {
      const ai = m.axis === "x" ? 0 : 1;
      for (const id of [m.low, m.high]) {
        const b = loopBBox(segBy.get(id)!.finished.outer);
        if (b[ai + 2] - b[ai] < cons.minSeamToBoundary) {
          add("error", "SEAM_NEAR_BOUNDARY", `Seam ${m.low}|${m.high} is closer than ${cons.minSeamToBoundary} mm to the far edge of segment ${id}.`, { cutId: m.cutId, segmentId: id });
        }
      }
    }
  }
  for (let s = 0; s + 1 < nStrips; s++) {
    seamByStrip[s].forEach((ca, ia) =>
      seamByStrip[s + 1].forEach((cb, ib) => {
        const d = Math.abs(usedAlong[s][ia] - usedAlong[s + 1][ib]);
        if (cons.forbidCrossJunctions && d < 1e-3) {
          add("error", "CROSS_JUNCTION", `Seams ${ca.id} and ${cb.id} meet at the same position (cross junction).`, { cutId: cb.id });
        } else if (cons.minSeamStagger !== undefined && d < cons.minSeamStagger) {
          add("error", "SEAM_STAGGER", `Seams ${ca.id} and ${cb.id} are ${r2(d)} mm apart (min ${cons.minSeamStagger}).`, { cutId: cb.id });
        }
      }),
    );
  }

  return finish(segments, seams);
}

/* ------------------------------------------------------------------ */
/* Candidate generation                                                */
/* ------------------------------------------------------------------ */

export interface GenSettings {
  /** ["H"], ["V"] or both for automatic direction selection. */
  directions: Direction[];
  sheet: SheetCtx;
  overlap: OverlapSpec;
  holePolicy: HolePolicy;
  constraints?: SeamConstraints;
  /** Stagger transverse seams between adjacent strips (default true). */
  staggered?: boolean;
  /** Also propose layouts sized to the raw sheet (margin-free "solo" segments). Default true. */
  allowSolo?: boolean;
  /**
   * "equal": strips of equal thickness only. "optimized" (default): also tries shifted first-cut
   * offsets so strip ends fall where the part is narrower.
   */
  pattern?: "equal" | "optimized";
  /** How many first-cut offsets to try inside the available slack (default 5). */
  offsetSamples?: number;
  confirmedHoleCuts?: string[];
  tol?: number;
}

export interface Candidate {
  id: string;
  label: string;
  direction: Direction;
  sheetIndex: number;
  limits: "usable" | "raw";
  swapped: boolean;
  pattern: string;
  plan: Plan;
}

const HOLE_CLEARANCE = 1; // mm — generator heuristic only, not a manufacturing rule

/** Move strip cuts out of holes where the strip-thickness limit allows it. */
function repairStripCuts(region: Region, direction: Direction, lo: number, hi: number, pos: number[], A: number): number[] {
  const ai = direction === "H" ? 1 : 0;
  const ranges = region.holes.map((h) => {
    const b = loopBBox(h);
    return [b[ai], b[ai + 2]] as [number, number];
  });
  if (!ranges.length) return pos;
  const out = pos.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < out.length; i++) {
      const inside = ranges.find(([h0, h1]) => out[i] > h0 - HOLE_CLEARANCE && out[i] < h1 + HOLE_CLEARANCE);
      if (!inside) continue;
      const prev = i === 0 ? lo : out[i - 1];
      const next = i === out.length - 1 ? hi : out[i + 1];
      const options = [inside[0] - HOLE_CLEARANCE, inside[1] + HOLE_CLEARANCE]
        .filter((p) => p - prev >= MIN_CUT_SPACING && next - p >= MIN_CUT_SPACING && p - prev <= A + 1e-9 && next - p <= A + 1e-9)
        .sort((a, b) => Math.abs(a - out[i]) - Math.abs(b - out[i]));
      if (options.length) out[i] = options[0];
    }
  }
  return out;
}

/** Transverse seams for each strip: balanced positions shifted to stagger against the previous strip and avoid holes. */
function placeSeamCuts(region: Region, gs: GenSettings, direction: Direction, stripPos: number[], L: number): SeamCut[] {
  const acrossAxis: Axis = direction === "H" ? "y" : "x";
  const ai = direction === "H" ? 0 : 1; // index of the along coordinate
  const cons = gs.constraints ?? {};
  const sl = sliceRegions([region], acrossAxis, stripPos);
  const out: SeamCut[] = [];
  let prev: number[] = [];
  const minPiece = Math.max(cons.minSeamToBoundary ?? 0, cons.minSegmentMm ?? 0, 1e-6);
  const target = Math.max(cons.minSeamStagger ?? 0, cons.forbidCrossJunctions ? 1 : 0);
  const staggered = gs.staggered ?? true;

  sl.strips.forEach((pieces, s) => {
    if (!pieces.length) {
      prev = [];
      return;
    }
    const boxes = pieces.map((p) => loopBBox(p.outer));
    const a0 = Math.min(...boxes.map((b) => b[ai]));
    const a1 = Math.max(...boxes.map((b) => b[ai + 2]));
    const len = a1 - a0;
    if (len <= L + 1e-9) {
      prev = [];
      return;
    }
    const m = Math.ceil(len / L - 1e-9);
    const base = len / m;
    const dmax = Math.max(0, L - base);
    const holeRanges = pieces.flatMap((p) => p.holes.map((h) => {
      const b = loopBBox(h);
      return [b[ai], b[ai + 2]] as [number, number];
    }));

    const feasible: { d: number; pos: number[]; D: number }[] = [];
    for (let t = 0; t <= 40; t++) {
      const d = dmax * ((t - 20) / 20);
      const pos = Array.from({ length: m - 1 }, (_, k) => a0 + (k + 1) * base + d);
      if (base + d < minPiece || base - d < minPiece) continue;
      if (pos.some((p) => holeRanges.some(([h0, h1]) => p > h0 - HOLE_CLEARANCE && p < h1 + HOLE_CLEARANCE))) continue;
      const D = prev.length ? Math.min(...pos.flatMap((p) => prev.map((q) => Math.abs(p - q)))) : Infinity;
      feasible.push({ d, pos, D });
    }
    feasible.sort((x, y) => Math.abs(x.d) - Math.abs(y.d) || x.d - y.d);

    let pick = feasible[0];
    if (!pick) pick = { d: 0, pos: Array.from({ length: m - 1 }, (_, k) => a0 + (k + 1) * base), D: 0 };
    else if (staggered && prev.length) {
      if (target > 0) {
        pick = feasible.find((f) => f.D >= target) ?? feasible.reduce((b, f) => (f.D > b.D ? f : b), feasible[0]);
      } else {
        const maxD = Math.max(...feasible.map((f) => f.D));
        pick = feasible.find((f) => f.D >= 0.9 * maxD) ?? feasible[0];
      }
    }
    pick.pos.forEach((p, k) => out.push({ id: `T${s + 1}.${k + 1}`, strip: s, pos: p }));
    prev = pick.pos;
  });
  return out;
}

/**
 * Proposes segmentations. For each direction × source sheet × limit mode (usable area, or the
 * raw sheet for margin-free solo segments) × orientation (90° only if the nest allows it) it
 * tries equal strips and several offsets of the first cut, then places staggered, hole-avoiding
 * transverse seams for strips longer than the sheet.
 *
 * Returned candidates are validated by `buildPlan`. They are listed valid-first, then by the
 * area-based sheet lower bound (a solo segment counts as a whole sheet), segment count and seam
 * length — a transparent default order, NOT a cost optimum; the engine-based ranking comes later.
 */
export function generateCandidates(regionIn: Region, gs: GenSettings): Candidate[] {
  const region = normalizeRegion(regionIn);
  const [bx0, by0, bx1, by1] = regionBBox(region);
  const o = gs.overlap.enabled && gs.overlap.mm > 0 ? gs.overlap.mm : 0; // only an overlap makes pieces bigger; a gap makes them smaller
  // worst case extension of one cell along one axis: both its sides can carry overlap with "alternate"
  const extra = o <= 0 ? 0 : gs.overlap.side === "alternate" ? 2 * o : o;
  const rot90 = rotList(gs.sheet.ro).some((r) => Math.abs(r % 180) === 90);
  const samples = Math.max(1, gs.offsetSamples ?? 5);
  const mg = gs.sheet.mg;
  const out: Candidate[] = [];
  const seen = new Set<string>();

  gs.sheet.sheets.forEach((sh, sheetIndex) => {
    if (!(sh.W > 0 && sh.H > 0)) return;
    for (const limits of (gs.allowSolo ?? true) ? (["usable", "raw"] as const) : (["usable"] as const)) {
      // "usable": what the optimiser can place on a margined sheet; "raw": a whole sheet, no margin (solo sheet)
      const cap = (len: number) => (gs.sheet.cell ? gridCapacity(len, mg, gs.sheet.gp ?? 0, gs.sheet.cell) : len - 2 * mg);
      const Wl = limits === "usable" ? cap(sh.W) : sh.W;
      const Hl = limits === "usable" ? cap(sh.H) : sh.H;
      if (Wl <= 0 || Hl <= 0) continue;
      for (const swapped of rot90 ? [false, true] : [false]) {
        const limX = swapped ? Hl : Wl;
        const limY = swapped ? Wl : Hl;
        for (const direction of gs.directions) {
          const A = (direction === "H" ? limY : limX) - extra;
          const L = (direction === "H" ? limX : limY) - extra;
          if (A <= 0 || L <= 0) continue;
          const lo = direction === "H" ? by0 : bx0;
          const hi = direction === "H" ? by1 : bx1;
          const E = hi - lo;
          const n = Math.max(1, Math.ceil(E / A - 1e-9));

          const sets: { tag: string; pos: number[] }[] = [];
          if (n === 1) sets.push({ tag: "single", pos: [] });
          else {
            sets.push({ tag: "equal", pos: Array.from({ length: n - 1 }, (_, i) => lo + ((i + 1) * E) / n) });
            const slack = n * A - E;
            for (let q = 0; q < (gs.pattern === "equal" ? 0 : samples); q++) {
              const f = samples === 1 ? 0 : q / (samples - 1);
              sets.push({ tag: `offset${Math.round(f * 100)}`, pos: Array.from({ length: n - 1 }, (_, i) => lo - slack * f + (i + 1) * A) });
            }
          }

          for (const cs of sets) {
            const stripPos = repairStripCuts(region, direction, lo, hi, cs.pos, A);
            const sig = `${direction}|${sheetIndex}|${limits}|${swapped}|${stripPos.map((p) => r2(p)).join(",")}`;
            if (seen.has(sig)) continue;
            seen.add(sig);
            const seamCuts = placeSeamCuts(region, gs, direction, stripPos, L);
            const plan = buildPlan(region, {
              direction,
              stripCuts: stripPos.map((pos, i) => ({ id: `C${i + 1}`, pos })),
              seamCuts,
              overlap: gs.overlap,
              sheet: gs.sheet,
              holePolicy: gs.holePolicy,
              confirmedHoleCuts: gs.confirmedHoleCuts,
              constraints: gs.constraints,
              tol: gs.tol,
            });
            out.push({
              id: `${direction}${sheetIndex}-${limits}-${swapped ? "rot" : "asis"}-${cs.tag}`,
              label:
                `${direction === "H" ? "Horizontal" : "Vertical"} · ${stripPos.length + 1} strip${stripPos.length ? "s" : ""} · ${plan.segments.length} segments` +
                ` · sheet ${r2(sh.W)}×${r2(sh.H)}${limits === "raw" ? " (zero margin)" : ""}${swapped ? " · turned 90°" : ""}`,
              direction, sheetIndex, limits, swapped, pattern: cs.tag, plan,
            });
          }
        }
      }
    }
  });

  const lb = (c: Candidate) => c.plan.metrics.sheetsLowerBound ?? Infinity;
  return out.sort(
    (a, b) =>
      Number(b.plan.valid) - Number(a.plan.valid) ||
      lb(a) - lb(b) ||
      a.plan.metrics.segments - b.plan.metrics.segments ||
      a.plan.metrics.cutLength - b.plan.metrics.cutLength ||
      a.id.localeCompare(b.id),
  );
}
