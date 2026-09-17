// Phase 3 — the real optimization layer on top of the geometry primitives
// in nesting-geometry.ts.

import type { Point } from "./dxf";
import {
  type RotationDeg,
  generateRotationCandidates,
  type BoundingBox,
  type OrientedShape,
  computeBoundingBox,
  computeOrientedShape,
  translatePoints,
  aabbOverlap,
  polygonsOverlap,
  polygonsMinDistance,
  boundsContain,
} from "./nesting-geometry";
import type { EngineConfig, EngineSourceInput, EnginePlacementResult, UnplacedReason } from "./nesting-engine";

export const OPTIMIZER_ALGORITHM_NAME = "candidate-search-multi-strategy-local-improvement";
export const OPTIMIZER_ALGORITHM_VERSION = "1.4.0";

/**
 * Width-first / length-first packing preference (follow-up to Phase 3).
 *
 * Coordinate mapping, confirmed in makeWorkingSheet() below and in
 * buildOccupancyGrid()'s comment ("lengthMm // X axis ... widthMm // Y
 * axis"): the WorkingSheet's X axis spans the sheet's PHYSICAL LENGTH
 * (source.lengthMm) and its Y axis spans the sheet's PHYSICAL WIDTH
 * (source.widthMm). So "fill across the width before extending along the
 * length" means preferring placements whose growth is along Y (width)
 * before growth along X (length).
 *
 * - AUTO: no directional bias — preserves pre-existing candidate ranking.
 * - WIDTH_FIRST: prefer placements that grow the occupied footprint's Y
 *   (width) extent over its X (length) extent.
 * - LENGTH_FIRST: the opposite — prefer growth along X (length) over Y
 *   (width). Approximates the previous default directional behavior.
 *
 * This is ONLY consulted as a small secondary term inside
 * computePlacementScore (see PACKING_PREFERENCE_WEIGHT below) — it never
 * participates in validity/collision/bounds checks and never influences
 * placed-count priority or the global scoreLayout()/scoreSheets()
 * objective.
 */
export type PackingPreference = "AUTO" | "WIDTH_FIRST" | "LENGTH_FIRST";

export interface OptimizerPartInstance {
  takeoffPartId: string;
  itemNo: number;
  instanceNumber: number;
  areaSqm: number;
  outer: Point[];
}

export interface OptimizerOptions {
  maxIterations?: number;
  maxCandidatesPerPart?: number;
  maxSolutions?: number;
  timeLimitMs?: number;
  randomSeed?: number;
  rotationStepDeg?: number;
  maxRotationCandidatesPerPart?: number;
  /**
   * Phase 2 — MULTI-START + TIME-BUDGETED GLOBAL SEARCH.
   *
   * Number of additional, seeded, randomized/perturbed construction starts
   * generated on top of the 8 fixed strategies from buildStrategies(). Each
   * one is a genuinely different complete part ordering (not a duplicate of
   * the fixed 8), explored subject to the construction time budget below.
   * Bounded and deterministic: same seed => same set of extra starts.
   */
  maxExtraRandomStarts?: number;
  /**
   * Width-first / length-first packing preference — see PackingPreference
   * above. Purely a secondary local-placement preference; does not change
   * validity, placed-count priority, or the global layout objective.
   * Default "AUTO" preserves existing behavior exactly (no new bias term).
   */
  packingPreference?: PackingPreference;
}

const DEFAULT_OPTIONS: Required<OptimizerOptions> = {
  maxIterations: 300,
  maxCandidatesPerPart: 60,
  maxSolutions: 4,
  timeLimitMs: 6000,
  randomSeed: 20260825,
  rotationStepDeg: 5,
  maxRotationCandidatesPerPart: 48,
  maxExtraRandomStarts: 16,
  packingPreference: "AUTO",
};

/**
 * Small, fixed weight applied to the directional preference term inside
 * computePlacementScore (see below). Deliberately tiny relative to the
 * existing growth/contact terms (which operate on raw mm^2 / mm*mm-scale
 * quantities, typically in the thousands) so the directional preference
 * can only meaningfully act when candidates are otherwise close, and can
 * never override a genuinely better growth/contact score.
 */
const PACKING_PREFERENCE_WEIGHT = 0.01;

// Fraction of the total time budget reserved for generating/evaluating
// complete candidate layouts (multi-start construction) before local
// improvement / ruin-and-recreate get the remainder. Keeps a handful of
// early, expensive strategies from starving every later start, and keeps
// later starts from starving improvement of the winner entirely.
const CONSTRUCTION_BUDGET_FRACTION = 0.6;

export interface OptimizedSheet {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  placements: EnginePlacementResult[];
}

export interface OptimizeGroupResult {
  sheets: OptimizedSheet[];
  placedCountByPart: Map<string, number>;
  failureReasonByPart: Map<string, UnplacedReason>;
  metrics: OptimizationMetrics;
}

export interface OptimizationMetrics {
  algorithm: string;
  algorithmVersion: string;
  strategiesEvaluated: number;
  localImprovementMoves: number;
  ruinAndRecreateIterations: number;
  timeMs: number;
  finalScore: number;
  candidatesEvaluated: number;
  usedBaseline: boolean;
  rotationStepDeg: number;
  sheetsUsed: number;
  utilizationPercent: number;
  scrapAreaSqm: number;
  /** Phase 2 — total complete candidate layouts constructed (fixed strategies + extra seeded/perturbed starts). */
  startsEvaluated: number;
  /** Phase 2 — name of the construction strategy/start that produced the winning candidate layout. */
  bestStart: string;
  /** Phase 2 — total placement candidates evaluated across every rotation/origin of every start (alias of candidatesEvaluated, kept explicit per multi-start reporting). */
  totalCandidateLayouts: number;
  /** Phase 3 — number of distinct solutions retained in the bounded solution pool at the end of the adaptive search (see PART A). Optional/additive — existing consumers of this interface are unaffected. */
  solutionPoolSize?: number;
  /** Phase 3 — per-ruin-operator lightweight statistics from the adaptive search (see PART G). Optional/additive. */
  ruinOperatorStats?: Record<string, RuinOperatorStats>;
  /** Phase 3 — how many adaptive ruin-and-recreate iterations were accepted (score/threshold-accepted, not necessarily improving) vs strictly improved the running best. Optional/additive. */
  ruinAndRecreateAccepted?: number;
  ruinAndRecreateImprovements?: number;
}

export const SCORE_WEIGHTS = {
  sheetCountPenalty: 1_000_000,
  scrapAreaWeight: 1_000,
  cavityAreaWeight: 50,
  utilizationBonusWeight: 10,
  /**
   * Phase 2A — conservative weight for the fragmentation/usable-space
   * component (see computeFragmentationScore below). Deliberately smaller
   * than BOTH scrapAreaWeight and cavityAreaWeight so this term can only
   * ever act as a tie-breaker between layouts that are already close on
   * sheet count/scrap/utilization — it must never be able to make a
   * layout with meaningfully worse scrap or utilization look better.
   */
  fragmentationWeight: 20,
  /**
   * Phase 2B — conservative weight for computeCompactnessScore. The metric
   * itself is a dimensionless ratio in [0, 1] (occupied-footprint-bbox
   * area / sheet area, see computeCompactnessScore), so a weight of 200
   * contributes at most ~200 to the total score for a maximally-spread
   * single-sheet layout — smaller than scrapAreaWeight's contribution for
   * even a modest (0.2 sqm) scrap difference (0.2*1000=200), and utterly
   * dwarfed by sheetCountPenalty. Like fragmentationWeight, this can only
   * ever break ties between layouts that are already close on the primary
   * objectives.
   */
  compactnessWeight: 200,
  /**
   * Phase 2B — conservative weight for computeFutureFitScore. The metric is
   * an area (sqm) of free space judged too small/oddly-shaped for ANY
   * remaining part type, exactly analogous in units to fragmentationAreaSqm
   * (Phase 2A). Using the SAME weight scale as fragmentationWeight keeps
   * the two "usable remaining space" signals comparably influential,
   * without either one being able to overpower scrap/utilization.
   */
  futureFitWeight: 20,
};

/**
 * Phase 2B — bounded cap on how many DISTINCT remaining part types are
 * considered by computeFutureFitScore per call. Keeps the metric's cost
 * fixed regardless of how many instances/types remain, and deliberately
 * avoids ever scaling with instance QUANTITY (only distinct outer shapes
 * matter for a "could a part like this fit here" check).
 */
const MAX_FUTURE_FIT_REPRESENTATIVE_PARTS = 12;

/**
 * Phase 2B — bounded cap on iterative localImprovement() passes (see PART
 * E). A single relocation pass can leave further, now-newly-available
 * improving moves on the table (e.g. relocating part A can open up a
 * better spot for part B that was already tried earlier in the same
 * pass); repeating the pass a small, fixed number of times lets those
 * follow-on improvements be found while keeping the total work bounded and
 * independent of part count or wall-clock time (the existing deadline
 * check still applies within and across passes).
 */
const MAX_LOCAL_IMPROVEMENT_PASSES = 3;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorkingSheet {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  placements: EnginePlacementResult[];
  polygons: Point[][];
}

export function makeWorkingSheet(source: EngineSourceInput, config: EngineConfig): WorkingSheet {
  return {
    sourceSheetId: source.sourceSheetId,
    material: source.material,
    thicknessMm: source.thicknessMm,
    widthMm: source.widthMm,
    lengthMm: source.lengthMm,
    minX: config.marginLeftMm,
    minY: config.marginBottomMm,
    maxX: source.lengthMm - config.marginRightMm,
    maxY: source.widthMm - config.marginTopMm,
    placements: [],
    polygons: [],
  };
}

function cloneWorkingSheet(sheet: WorkingSheet): WorkingSheet {
  return {
    ...sheet,
    placements: sheet.placements.map((p) => ({ ...p })),
    polygons: sheet.polygons.map((poly) => poly.map((p) => ({ ...p }))),
  };
}

function cloneLayout(sheets: WorkingSheet[]): WorkingSheet[] {
  return sheets.map(cloneWorkingSheet);
}

function usableWidth(sheet: WorkingSheet): number {
  return Math.max(0, sheet.maxX - sheet.minX);
}
function usableHeight(sheet: WorkingSheet): number {
  return Math.max(0, sheet.maxY - sheet.minY);
}

export class RotationCandidateCache {
  private readonly cache = new Map<string, RotationDeg[]>();
  private evaluations = 0;

  constructor(
    private readonly rotationStepDeg: number,
    private readonly maxCandidates: number,
  ) { }

  get(instance: OptimizerPartInstance): RotationDeg[] {
    const cached = this.cache.get(instance.takeoffPartId);
    if (cached) return cached;
    const candidates = generateRotationCandidates(instance.outer, this.rotationStepDeg, this.maxCandidates);
    this.cache.set(instance.takeoffPartId, candidates);
    return candidates;
  }

  recordEvaluation(count = 1): void {
    this.evaluations += count;
  }

  get evaluationCount(): number {
    return this.evaluations;
  }
}

function couldEverFit(instance: OptimizerPartInstance, source: EngineSourceInput, config: EngineConfig, rotations: RotationCandidateCache): boolean {
  const w = Math.max(0, source.lengthMm - config.marginLeftMm - config.marginRightMm);
  const h = Math.max(0, source.widthMm - config.marginTopMm - config.marginBottomMm);
  for (const rotation of rotations.get(instance)) {
    const shape = computeOrientedShape(instance.outer, rotation);
    if (shape.width <= w + 1e-6 && shape.height <= h + 1e-6) return true;
  }
  return false;
}

/**
 * Fix 2 — bounded candidate ORIGIN sampling (deliberately not exhaustive:
 * generateCandidateOrigins can produce far more raw origins than
 * `maxCandidatesPerPart`, and evaluating every one of them per part per
 * rotation per sheet would be the real performance cost this cap exists to
 * avoid). This is explicitly a BOUNDED SAMPLE of the candidate space, not
 * "all candidates" — findBestPlacement() picks the BEST VALID candidate
 * among exactly the origins this function returns, no more.
 *
 * Selection strategy (deterministic, no randomness):
 *  - keep the best/lowest-Y-then-X origins first — these are typically the
 *    strongest compactness picks and a cheap, reasonable prior to keep;
 *  - fill the rest of the budget with an evenly-spaced deterministic STRIDE
 *    sample across the remaining sorted origins, so later spatial regions
 *    (later Y bands, later X columns) aren't systematically excluded just
 *    because the cap was reached before the sort got to them.
 * Both parts are pure functions of the (already deterministic) sorted
 * input list, so the same geometry always yields the same bounded set.
 */
export function selectBoundedCandidateOrigins(sorted: Point[], cap: number): Point[] {
  if (sorted.length <= cap) return sorted;

  const PRESERVE_FRACTION = 0.5;
  const preserveCount = Math.min(sorted.length, Math.max(1, Math.round(cap * PRESERVE_FRACTION)));
  const selected: Point[] = sorted.slice(0, preserveCount);

  const remaining = sorted.slice(preserveCount);
  const strideBudget = cap - selected.length;
  if (strideBudget > 0 && remaining.length > 0) {
    const stride = remaining.length / strideBudget;
    const seenIdx = new Set<number>();
    for (let i = 0; i < strideBudget; i++) {
      const idx = Math.min(remaining.length - 1, Math.floor(i * stride));
      if (seenIdx.has(idx)) continue;
      seenIdx.add(idx);
      selected.push(remaining[idx]);
    }
  }
  return selected;
}

export function generateCandidateOrigins(
  shapeWidth: number,
  shapeHeight: number,
  sheet: WorkingSheet,
  gap: number,
  cap: number,
): Point[] {
  const raw: Point[] = [{ x: sheet.minX, y: sheet.minY }];

  for (const poly of sheet.polygons) {
    const bbox = computeBoundingBox(poly);
    for (const v of poly) {
      raw.push({ x: v.x + gap, y: v.y });
      raw.push({ x: v.x, y: v.y + gap });
      raw.push({ x: v.x - shapeWidth - gap, y: v.y });
      raw.push({ x: v.x, y: v.y - shapeHeight - gap });
    }
    raw.push({ x: bbox.maxX + gap, y: bbox.minY });
    raw.push({ x: bbox.minX, y: bbox.maxY + gap });
    raw.push({ x: bbox.maxX + gap, y: bbox.maxY - shapeHeight });
    raw.push({ x: bbox.maxX - shapeWidth, y: bbox.maxY + gap });
  }

  const seen = new Set<string>();
  const filtered: Point[] = [];
  for (const p of raw) {
    if (p.x < sheet.minX - 1e-6 || p.y < sheet.minY - 1e-6) continue;
    if (p.x + shapeWidth > sheet.maxX + 1e-6 || p.y + shapeHeight > sheet.maxY + 1e-6) continue;
    const key = `${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(p);
  }

  filtered.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  // Bounded candidate sampling (Fix 2) — see selectBoundedCandidateOrigins.
  // This is intentionally BEST VALID among a bounded, spatially-diverse
  // SAMPLE of generated origins, not BEST VALID among literally every
  // origin generateCandidateOrigins() could produce.
  return selectBoundedCandidateOrigins(filtered, cap);
}

// ---------------------------------------------------------------------------
// Phase 4A — bounded NFP-style / Minkowski-style true-shape candidate
// generation.
// ---------------------------------------------------------------------------
// NOTE ON TERMINOLOGY: this is a bounded, conservative APPROXIMATION
// inspired by no-fit-polygon (NFP) / Minkowski-sum concepts — it is NOT a
// complete, exact industrial NFP implementation (no full Minkowski-sum
// convex decomposition, no exact polygon sliding/trimming). It proposes a
// bounded set of candidate translations derived from the MOVING shape's
// and each OBSTACLE's actual contour vertices/edges (rather than only
// sheet corners, existing vertices, bbox corners and gap offsets, as
// generateCandidateOrigins does), so the optimizer can discover tighter
// valid placements for non-rectangular parts. It NEVER decides validity —
// every candidate it proposes still goes through the exact same
// boundsContain() / polygonsOverlap() / polygonsMinDistance() checks in
// findBestPlacement() as every other candidate (Part C: non-negotiable).

/** Bounded cap on how many true-shape candidates a single generateTrueShapeCandidates() call may return (Part H). */
export const MAX_TRUE_SHAPE_CANDIDATES = 64;

/**
 * Per-call caps on how many vertices of the MOVING shape and of any ONE
 * obstacle polygon are considered (Part H — avoids the
 * O(edgesA * edgesB * iterations) blowup a naive "every vertex against
 * every vertex of every obstacle" approach would hit on large/complex
 * DXF parts). Deterministic: always the first N vertices in the
 * polygon's existing (fixed) winding order, so the same geometry always
 * yields the same truncated vertex set.
 */
const MAX_TRUE_SHAPE_MOVING_VERTICES = 24;
const MAX_TRUE_SHAPE_OBSTACLE_VERTICES = 24;
/** Only obstacle polygons whose bbox is within this margin of the moving shape's local bbox diagonal are considered "near enough" to be worth generating contact candidates against — a cheap spatial prefilter (Part H). */
const TRUE_SHAPE_PROXIMITY_SLACK_MULTIPLIER = 3;

/** Lower bound on |cos(angle between two edge directions)| for two edges to be treated as "near-parallel" for edge-contact candidates (~11.5 degrees). */
const NEAR_PARALLEL_COS_THRESHOLD = 0.98;

/**
 * Lightweight, opt-in diagnostics counters for Phase 4A candidate
 * generation (Part L). Entirely optional — findBestPlacement() only
 * touches this when a caller explicitly passes one in, so there is zero
 * overhead (and zero behavior change) for existing callers. Never logged
 * to console; purely a plain object a caller can inspect/aggregate.
 */
export interface TrueShapeDiagnostics {
  existingCandidatesGenerated: number;
  trueShapeCandidatesGenerated: number;
  candidatesValidated: number;
  validCandidatesFound: number;
}

export function makeTrueShapeDiagnostics(): TrueShapeDiagnostics {
  return { existingCandidatesGenerated: 0, trueShapeCandidatesGenerated: 0, candidatesValidated: 0, validCandidatesFound: 0 };
}

function polygonCentroidSimple(poly: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** Approximate outward normal at a polygon vertex: direction from the polygon's centroid to that vertex. Simple and robust for both convex and concave polygons (it can be geometrically imprecise right at a concave notch, but that only affects which APPROXIMATE candidates get proposed — never validity, which exact validation still decides). */
function outwardNormalAtPoint(p: Point, centroid: Point): Point {
  const dx = p.x - centroid.x;
  const dy = p.y - centroid.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Outward normal of an edge (a -> b): perpendicular to the edge, oriented toward the side AWAY from the polygon's centroid. */
function edgeOutwardNormal(a: Point, b: Point, centroid: Point): Point {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey);
  if (len < 1e-9) return { x: 1, y: 0 };
  let nx = -ey / len;
  let ny = ex / len;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toMid = { x: mid.x - centroid.x, y: mid.y - centroid.y };
  if (nx * toMid.x + ny * toMid.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/**
 * Bounded NFP-style/Minkowski-style candidate generator (Phase 4A, Part B).
 *
 * `movingPoints` is the moving shape's OWN oriented, bbox-normalized outer
 * contour (i.e. `computeOrientedShape(...).points` for some rotation — the
 * SAME representation findBestPlacement() already uses for every other
 * candidate, so results plug straight into the existing pipeline). Only
 * the outer contour is used (Part E — matches the existing optimizer's
 * geometry model, which does not carry hole geometry into
 * OptimizerPartInstance/WorkingSheet at all; see report).
 *
 * `obstaclePolygons` are already-placed parts' outer contours in the
 * SHEET's global coordinate frame (`sheet.polygons`).
 *
 * Returns a bounded, deterministic list of candidate ORIGINS — i.e.
 * translations to apply to `movingPoints` (the same (x, y) convention
 * generateCandidateOrigins() uses) — derived from:
 *   1. vertex-to-vertex proximity,
 *   2. vertex-to-edge proximity (moving vertex approaching an obstacle edge),
 *   3. edge-to-vertex proximity (obstacle vertex approaching a moving edge),
 *   4. near-parallel edge contact,
 *   5. every one of the above already includes a `gapMm` outward offset
 *      (gap-offset contact positions).
 *
 * This is a proposal step ONLY — see the Part C note above. Nothing here
 * decides whether a candidate is actually usable.
 */
export function generateTrueShapeCandidates(
  movingPoints: Point[],
  obstaclePolygons: Point[][],
  gapMm: number,
  cap: number = MAX_TRUE_SHAPE_CANDIDATES,
  diagnostics?: TrueShapeDiagnostics,
): Point[] {
  if (movingPoints.length < 3 || obstaclePolygons.length === 0) return [];

  const movingBBox = computeBoundingBox(movingPoints);
  const movingDiagonal = Math.hypot(movingBBox.width, movingBBox.height);
  const movingCentroid = polygonCentroidSimple(movingPoints);
  const movingVerts = movingPoints.length <= MAX_TRUE_SHAPE_MOVING_VERTICES ? movingPoints : movingPoints.slice(0, MAX_TRUE_SHAPE_MOVING_VERTICES);

  const raw: Point[] = [];

  for (const obstacle of obstaclePolygons) {
    if (obstacle.length < 3) continue;

    // Cheap spatial prefilter (Part H): an obstacle far outside any
    // plausible contact range of the moving shape can't produce a useful
    // contact candidate, so skip generating (and later deduplicating)
    // candidates against it entirely.
    const obstacleBBox = computeBoundingBox(obstacle);
    const proximitySlack = movingDiagonal * TRUE_SHAPE_PROXIMITY_SLACK_MULTIPLIER + gapMm;
    const nearEnough =
      obstacleBBox.minX - proximitySlack <= movingBBox.maxX + proximitySlack &&
      obstacleBBox.maxX + proximitySlack >= movingBBox.minX - proximitySlack &&
      obstacleBBox.minY - proximitySlack <= movingBBox.maxY + proximitySlack &&
      obstacleBBox.maxY + proximitySlack >= movingBBox.minY - proximitySlack;
    if (!nearEnough) continue;

    const obstacleCentroid = polygonCentroidSimple(obstacle);
    const obVerts = obstacle.length <= MAX_TRUE_SHAPE_OBSTACLE_VERTICES ? obstacle : obstacle.slice(0, MAX_TRUE_SHAPE_OBSTACLE_VERTICES);

    // 1) vertex-to-vertex proximity: place a moving vertex just outside an obstacle vertex.
    for (const Vm of movingVerts) {
      for (const Wo of obVerts) {
        const n = outwardNormalAtPoint(Wo, obstacleCentroid);
        raw.push({ x: Wo.x + n.x * gapMm - Vm.x, y: Wo.y + n.y * gapMm - Vm.y });
      }
    }

    // 2) vertex-to-edge proximity: a moving vertex approaching an obstacle edge's midpoint.
    for (const Vm of movingVerts) {
      for (let i = 0; i < obVerts.length; i++) {
        const a = obVerts[i];
        const b = obVerts[(i + 1) % obVerts.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const n = edgeOutwardNormal(a, b, obstacleCentroid);
        raw.push({ x: mid.x + n.x * gapMm - Vm.x, y: mid.y + n.y * gapMm - Vm.y });
      }
    }

    // 3) edge-to-vertex proximity: an obstacle vertex approaching a moving edge's midpoint.
    for (let i = 0; i < movingVerts.length; i++) {
      const a = movingVerts[i];
      const b = movingVerts[(i + 1) % movingVerts.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const n = edgeOutwardNormal(a, b, movingCentroid);
      for (const Wo of obVerts) {
        raw.push({ x: Wo.x - n.x * gapMm - mid.x, y: Wo.y - n.y * gapMm - mid.y });
      }
    }

    // 4) near-parallel edge contact: flush-align a moving edge against an obstacle edge.
    for (let i = 0; i < movingVerts.length; i++) {
      const ma = movingVerts[i];
      const mb = movingVerts[(i + 1) % movingVerts.length];
      const mdx = mb.x - ma.x;
      const mdy = mb.y - ma.y;
      const mlen = Math.hypot(mdx, mdy);
      if (mlen < 1e-9) continue;
      const mdir = { x: mdx / mlen, y: mdy / mlen };
      const mmid = { x: (ma.x + mb.x) / 2, y: (ma.y + mb.y) / 2 };

      for (let j = 0; j < obVerts.length; j++) {
        const oa = obVerts[j];
        const ob = obVerts[(j + 1) % obVerts.length];
        const odx = ob.x - oa.x;
        const ody = ob.y - oa.y;
        const olen = Math.hypot(odx, ody);
        if (olen < 1e-9) continue;
        const odir = { x: odx / olen, y: ody / olen };
        const dot = mdir.x * odir.x + mdir.y * odir.y;
        if (Math.abs(dot) < NEAR_PARALLEL_COS_THRESHOLD) continue; // not near-parallel enough to be a useful flush-contact candidate

        const omid = { x: (oa.x + ob.x) / 2, y: (oa.y + ob.y) / 2 };
        const on = edgeOutwardNormal(oa, ob, obstacleCentroid);
        raw.push({ x: omid.x + on.x * gapMm - mmid.x, y: omid.y + on.y * gapMm - mmid.y });
      }
    }
  }

  if (diagnostics) diagnostics.trueShapeCandidatesGenerated += raw.length;

  // Deterministic deduplication (Part J): a small coordinate quantization
  // used ONLY to collapse effectively-identical candidates — the actual
  // (x, y) values pushed into `dedup` remain full, unrounded precision.
  const DEDUP_QUANTIZE_MM = 0.01;
  const seen = new Set<string>();
  const dedup: Point[] = [];
  for (const p of raw) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const key = `${Math.round(p.x / DEDUP_QUANTIZE_MM)}:${Math.round(p.y / DEDUP_QUANTIZE_MM)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(p);
  }

  // Deterministic ordering + bounded cap (Part H, Part J), reusing the
  // same deterministic "lowest Y, then lowest X, then evenly-spaced
  // stride sample" selection the existing bbox-based candidate generator
  // uses (selectBoundedCandidateOrigins), so true-shape candidates are
  // bounded and sampled the same principled way as every other candidate
  // source rather than by an arbitrary/ad hoc truncation.
  dedup.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  return selectBoundedCandidateOrigins(dedup, cap);
}

/**
 * Phase 4A, Part G — hybrid candidate generation: existing bbox/vertex
 * candidates PLUS bounded true-shape candidates, deduplicated, funneled
 * into ONE combined pool that findBestPlacement() then validates and
 * scores exactly as before. The existing generator remains fully
 * functional and is always included — if true-shape generation finds
 * nothing (e.g. no obstacles placed yet), this returns exactly what
 * generateCandidateOrigins() alone would have returned (backward
 * compatible, Part G).
 */
function generateHybridCandidateOrigins(
  shape: OrientedShape,
  sheet: WorkingSheet,
  gapMm: number,
  maxCandidates: number,
  diagnostics?: TrueShapeDiagnostics,
): Point[] {
  const existing = generateCandidateOrigins(shape.width, shape.height, sheet, gapMm, maxCandidates);
  if (diagnostics) diagnostics.existingCandidatesGenerated += existing.length;

  if (sheet.polygons.length === 0) return existing;

  const trueShapeRaw = generateTrueShapeCandidates(shape.points, sheet.polygons, gapMm, MAX_TRUE_SHAPE_CANDIDATES, diagnostics);
  if (trueShapeRaw.length === 0) return existing;

  const seen = new Set<string>();
  const combined: Point[] = [];
  for (const p of existing) {
    const key = `${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(p);
  }
  for (const p of trueShapeRaw) {
    // Same in-bounds prefilter generateCandidateOrigins() applies to its
    // own raw candidates — true-shape candidates get no special pass.
    if (p.x < sheet.minX - 1e-6 || p.y < sheet.minY - 1e-6) continue;
    if (p.x + shape.width > sheet.maxX + 1e-6 || p.y + shape.height > sheet.maxY + 1e-6) continue;
    const key = `${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(p);
  }
  return combined;
}

interface PlacementAttempt {
  x: number;
  y: number;
  rotationDeg: RotationDeg;
  width: number;
  height: number;
  polygon: Point[];
  /**
   * The local placement-quality score (see computePlacementScore below;
   * lower is better) that findBestPlacement() used to pick this candidate
   * among every valid candidate/rotation it evaluated. Exposed here (Fix 1)
   * so callers that compare PlacementAttempts gathered from MULTIPLE
   * separate findBestPlacement() calls — e.g. localImprovement() picking
   * the best relocation sheet — can rank them with the exact same
   * comparison rule findBestPlacement() itself uses internally, instead of
   * a second, weaker ad hoc comparison.
   */
  score: number;
}

// ---------------------------------------------------------------------------
// Phase: FIRST VALID -> BEST VALID
// ---------------------------------------------------------------------------
// A lightweight, LOCAL placement-quality heuristic — deliberately NOT the
// full `scoreSheets()` global objective (that would mean rebuilding/scoring
// an entire multi-sheet layout per candidate, i.e. O(n^4)-ish blowup for no
// benefit). This only needs to rank candidates for ONE part on ONE sheet
// against each other, so it looks at exactly the things that differ between
// candidates: how much new sheet area the candidate pulls into use, and how
// snugly it sits against what's already there.
//
// Bounding boxes are used here deliberately (Phase 7 allows bbox-based
// SCORING heuristics — only final collision/gap validation must stay exact
// polygon geometry, which happens before this function is ever called).
interface ScoredCandidate extends PlacementAttempt {
  candidateIndex: number;
}

function unionBBox(a: BoundingBox | null, b: BoundingBox): BoundingBox {
  if (!a) return b;
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX);
  const maxY = Math.max(a.maxY, b.maxY);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function occupiedBBoxArea(b: BoundingBox | null): number {
  if (!b) return 0;
  return Math.max(0, b.width) * Math.max(0, b.height);
}

/**
 * How much of the candidate's edges "hug" something already fixed — the
 * sheet boundary or another placed part's bounding box — within the
 * required gap. A candidate that snugs up against existing material
 * leaves the remaining free area more contiguous (better future-fit,
 * less fragmentation); a candidate floating in open space with the same
 * bounding-box growth doesn't.
 */
function contactLength(candidate: BoundingBox, sheet: WorkingSheet, obstacleBoxes: BoundingBox[], gapMm: number): number {
  const eps = 1e-6;
  const tol = gapMm + eps;
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;
  let total = 0;

  if (near(candidate.minX, sheet.minX)) total += candidate.height;
  if (near(candidate.maxX, sheet.maxX)) total += candidate.height;
  if (near(candidate.minY, sheet.minY)) total += candidate.width;
  if (near(candidate.maxY, sheet.maxY)) total += candidate.width;

  for (const ob of obstacleBoxes) {
    const yOverlap = Math.min(candidate.maxY, ob.maxY) - Math.max(candidate.minY, ob.minY);
    if (yOverlap > 0 && (near(candidate.minX, ob.maxX) || near(candidate.maxX, ob.minX))) {
      total += yOverlap;
    }
    const xOverlap = Math.min(candidate.maxX, ob.maxX) - Math.max(candidate.minX, ob.minX);
    if (xOverlap > 0 && (near(candidate.minY, ob.maxY) || near(candidate.maxY, ob.minY))) {
      total += xOverlap;
    }
  }
  return total;
}

/**
 * Lower is better. `growth` (mm^2, how much bigger the sheet's overall
 * occupied bounding box becomes) is the dominant term — it's what
 * "compactness" / "incremental bounding-box growth" (Phase 4 A/B)
 * actually means. `contactLength` (mm) is converted to a comparable
 * area-ish unit via `contactScale`, then subtracted — snugger placements
 * score better for the same growth.
 *
 * `contactScale` MUST be a fixed value shared across every candidate
 * being compared in one `findBestPlacement` call (including every
 * rotation) — NOT derived from the candidate's own bounding box. Using a
 * candidate-dependent scale (e.g. that candidate's own avgDim) creates a
 * perverse bias: a WORSE rotation with a genuinely larger bounding box
 * would earn a proportionally larger "contact credit" simply for being
 * bigger, even though corner-touching happens for basically any
 * rotation. Using the part's true (rotation-invariant) area instead
 * keeps the comparison fair across rotations of the same part.
 */
/**
 * Directional secondary preference (see PackingPreference above). Compares
 * how much the occupied footprint's X extent (physical LENGTH) grows
 * versus its Y extent (physical WIDTH) when this candidate is added, and
 * returns a small signed bias — lower is better, matching
 * computePlacementScore's convention.
 *
 * WIDTH_FIRST: penalize growth along X (length) more than growth along Y
 * (width), so candidates that extend the footprint across the width
 * before lengthening it are preferred.
 * LENGTH_FIRST: the opposite.
 * AUTO: always 0 — no bias, existing ranking is unchanged.
 */
function packingPreferenceBias(
  occupiedBefore: BoundingBox | null,
  occupiedAfter: BoundingBox,
  packingPreference: PackingPreference,
): number {
  if (packingPreference === "AUTO") return 0;

  const lengthGrowth = occupiedAfter.width - (occupiedBefore ? occupiedBefore.width : 0); // X axis == physical lengthMm
  const widthGrowth = occupiedAfter.height - (occupiedBefore ? occupiedBefore.height : 0); // Y axis == physical widthMm

  if (packingPreference === "WIDTH_FIRST") {
    return PACKING_PREFERENCE_WEIGHT * (lengthGrowth - widthGrowth);
  }
  // LENGTH_FIRST
  return PACKING_PREFERENCE_WEIGHT * (widthGrowth - lengthGrowth);
}

function computePlacementScore(
  candidateBBox: BoundingBox,
  occupiedBefore: BoundingBox | null,
  sheet: WorkingSheet,
  obstacleBoxes: BoundingBox[],
  gapMm: number,
  contactScale: number,
  packingPreference: PackingPreference = "AUTO",
): number {
  const occupiedAfter = unionBBox(occupiedBefore, candidateBBox);
  const growth = occupiedBBoxArea(occupiedAfter) - occupiedBBoxArea(occupiedBefore);
  const contact = contactLength(candidateBBox, sheet, obstacleBoxes, gapMm);
  const directionalBias = packingPreferenceBias(occupiedBefore, occupiedAfter, packingPreference);
  return growth - contact * contactScale + directionalBias;
}

export function findBestPlacement(
  instance: OptimizerPartInstance,
  sheet: WorkingSheet,
  config: EngineConfig,
  maxCandidates: number,
  rotations: RotationCandidateCache,
  packingPreference: PackingPreference = "AUTO",
  diagnostics?: TrueShapeDiagnostics,
): PlacementAttempt | null {
  if (usableWidth(sheet) <= 0 || usableHeight(sheet) <= 0) return null;

  // Occupied bounding box BEFORE this part is placed — the baseline every
  // candidate's incremental growth is measured against. Cheap: bounded by
  // the (already capped) number of placements on this sheet.
  let occupiedBefore: BoundingBox | null = null;
  const obstacleBoxes: BoundingBox[] = new Array(sheet.placements.length);
  for (let i = 0; i < sheet.placements.length; i++) {
    const p = sheet.placements[i];
    const box: BoundingBox = {
      minX: p.xMm,
      minY: p.yMm,
      maxX: p.xMm + p.widthMm,
      maxY: p.yMm + p.heightMm,
      width: p.widthMm,
      height: p.heightMm,
    };
    obstacleBoxes[i] = box;
    occupiedBefore = unionBBox(occupiedBefore, box);
  }

  // Fixed once per part (true polygon area is rotation-invariant), so
  // every rotation candidate is scored on a level playing field — see
  // the contract note on computePlacementScore above.
  const contactScale = Math.sqrt(Math.max(1, instance.areaSqm * 1_000_000));

  // Phase: FIRST VALID -> BEST VALID. Every valid candidate, across every
  // rotation, is scored; we no longer stop at the first one that passes
  // geometry validation. `candidateIndex` gives a stable, deterministic
  // tie-break (Phase 4-F) that doesn't depend on floating-point score
  // comparisons when two candidates are effectively equal.
  let candidateIndex = 0;
  let best: ScoredCandidate | null = null;

  for (const rotation of rotations.get(instance)) {
    const shape = computeOrientedShape(instance.outer, rotation);
    if (shape.width > usableWidth(sheet) + 1e-6 || shape.height > usableHeight(sheet) + 1e-6) continue;

    const candidates = generateHybridCandidateOrigins(shape, sheet, config.partGapMm, maxCandidates, diagnostics);

    for (const c of candidates) {
      rotations.recordEvaluation();
      if (diagnostics) diagnostics.candidatesValidated++;
      const polygon = translatePoints(shape.points, c.x, c.y);

      // ---- exact geometry validation (unchanged from before) ----------
      if (!boundsContain(polygon, sheet.minX, sheet.minY, sheet.maxX, sheet.maxY)) continue;

      const candidateBBox: BoundingBox = {
        minX: c.x,
        minY: c.y,
        maxX: c.x + shape.width,
        maxY: c.y + shape.height,
        width: shape.width,
        height: shape.height,
      };

      let polygonCollision = false;
      for (let i = 0; i < sheet.placements.length; i++) {
        const existingBBox = obstacleBoxes[i];
        // Broad-phase: bbox expanded by the required gap. A candidate
        // whose bbox doesn't even come within `gap` of this part's bbox
        // can't possibly violate the gap either, so skip the expensive
        // exact check entirely — this is a cheap pre-filter, not the
        // final decision.
        const expanded: BoundingBox = {
          minX: existingBBox.minX - config.partGapMm,
          minY: existingBBox.minY - config.partGapMm,
          maxX: existingBBox.maxX + config.partGapMm,
          maxY: existingBBox.maxY + config.partGapMm,
          width: existingBBox.width + config.partGapMm * 2,
          height: existingBBox.height + config.partGapMm * 2,
        };
        if (!aabbOverlap(candidateBBox, expanded)) continue;

        if (polygonsOverlap(polygon, sheet.polygons[i])) {
          polygonCollision = true;
          break;
        }
        // The required gap is verified with EXACT polygon-to-polygon
        // distance (not the bbox above, which is only a broad-phase
        // pre-filter) — a non-rectangular outline's real clearance is
        // what gets measured, not its bounding box's.
        if (config.partGapMm > 0 && polygonsMinDistance(polygon, sheet.polygons[i]) < config.partGapMm - 1e-6) {
          polygonCollision = true;
          break;
        }
      }
      if (polygonCollision) continue;

      // ---- candidate is valid: score it, don't return early -----------
      if (diagnostics) diagnostics.validCandidatesFound++;
      const score = computePlacementScore(candidateBBox, occupiedBefore, sheet, obstacleBoxes, config.partGapMm, contactScale, packingPreference);
      const scored: ScoredCandidate = {
        x: c.x,
        y: c.y,
        rotationDeg: rotation,
        width: shape.width,
        height: shape.height,
        polygon,
        score,
        candidateIndex: candidateIndex++,
      };

      if (!best || isBetterCandidate(scored, best)) {
        best = scored;
      }
    }
  }

  return best;
}

/**
 * Fix 1 — the SINGLE shared placement-quality ranking rule (Phase 4-F,
 * unified across findBestPlacement's own within-call comparison AND
 * localImprovement's cross-sheet relocation comparison — see below): lower
 * score wins; ties fall through to lower Y, then lower X, then lower
 * rotation. Returns <0 if `a` is strictly better, >0 if `b` is strictly
 * better, 0 if the two are equal on every one of these fields.
 *
 * Deliberately does NOT include a final index/id tie-break — that part of
 * "stable, deterministic tie-break" is left to each caller, because what a
 * stable final tie-break should be depends on the caller's search space:
 * within one findBestPlacement() call it's the candidate's generation
 * order (candidateIndex); across several separate findBestPlacement()
 * calls (one per sheet) it's simply "first sheet evaluated wins a tie",
 * which naturally falls out of iterating sheets in order and only
 * replacing the running best on a STRICT improvement (cmp < 0) — no
 * separate tie-break value needs to be threaded through at all.
 */
export function comparePlacementQuality(a: PlacementQuality, b: PlacementQuality): number {
  const SCORE_EPS = 1e-6;
  if (a.score < b.score - SCORE_EPS) return -1;
  if (a.score > b.score + SCORE_EPS) return 1;
  if (Math.abs(a.y - b.y) > 1e-9) return a.y - b.y;
  if (Math.abs(a.x - b.x) > 1e-9) return a.x - b.x;
  if (a.rotationDeg !== b.rotationDeg) return a.rotationDeg - b.rotationDeg;
  return 0;
}

interface PlacementQuality {
  score: number;
  x: number;
  y: number;
  rotationDeg: RotationDeg;
}

/**
 * Deterministic comparison used to pick the winning candidate WITHIN one
 * findBestPlacement() call. Ties within comparePlacementQuality's epsilon
 * fall through to the stable candidateIndex (Phase 4-F) — the one piece of
 * tie-break that's specific to comparing candidates generated in the same
 * call. No randomness anywhere in this comparison.
 */
function isBetterCandidate(a: ScoredCandidate, b: ScoredCandidate): boolean {
  const cmp = comparePlacementQuality(a, b);
  if (cmp !== 0) return cmp < 0;
  return a.candidateIndex < b.candidateIndex;
}


function commitPlacement(sheet: WorkingSheet, instance: OptimizerPartInstance, attempt: PlacementAttempt): void {
  sheet.placements.push({
    takeoffPartId: instance.takeoffPartId,
    instanceNumber: instance.instanceNumber,
    xMm: attempt.x,
    yMm: attempt.y,
    rotationDeg: attempt.rotationDeg,
    widthMm: attempt.width,
    heightMm: attempt.height,
  });
  sheet.polygons.push(attempt.polygon);
}

interface ConstructResult {
  sheets: WorkingSheet[];
  placedCountByPart: Map<string, number>;
  failureReasonByPart: Map<string, UnplacedReason>;
}

function constructLayout(
  orderedInstances: OptimizerPartInstance[],
  rankedSources: EngineSourceInput[],
  config: EngineConfig,
  maxCandidates: number,
  rotations: RotationCandidateCache,
  packingPreference: PackingPreference = "AUTO",
): ConstructResult {
  const sheets: WorkingSheet[] = [];
  const openedCountBySourceId = new Map<string, number>();

  function openNextSheet(): WorkingSheet | null {
    for (const sourceDef of rankedSources) {
      const cap = sourceDef.availableQty ?? null;
      const openedSoFar = openedCountBySourceId.get(sourceDef.sourceSheetId) ?? 0;
      if (cap != null && openedSoFar >= cap) continue;
      openedCountBySourceId.set(sourceDef.sourceSheetId, openedSoFar + 1);
      const sheet = makeWorkingSheet(sourceDef, config);
      sheets.push(sheet);
      return sheet;
    }
    return null;
  }

  function hasRemainingCapacity(): boolean {
    return rankedSources.some((s) => {
      const cap = s.availableQty ?? null;
      if (cap == null) return true;
      return (openedCountBySourceId.get(s.sourceSheetId) ?? 0) < cap;
    });
  }

  const placedCountByPart = new Map<string, number>();
  const failureReasonByPart = new Map<string, UnplacedReason>();

  for (const instance of orderedInstances) {
    let placed = false;

    for (const sheet of sheets) {
      const attempt = findBestPlacement(instance, sheet, config, maxCandidates, rotations, packingPreference);
      if (attempt) {
        commitPlacement(sheet, instance, attempt);
        placed = true;
        break;
      }
    }

    if (!placed) {
      let freshAttempts = 0;
      while (!placed && freshAttempts < rankedSources.length) {
        const sheet = openNextSheet();
        if (!sheet) break;
        freshAttempts++;
        const attempt = findBestPlacement(instance, sheet, config, maxCandidates, rotations, packingPreference);
        if (attempt) {
          commitPlacement(sheet, instance, attempt);
          placed = true;
        }
      }
    }

    if (placed) {
      placedCountByPart.set(instance.takeoffPartId, (placedCountByPart.get(instance.takeoffPartId) ?? 0) + 1);
      continue;
    }

    let reason: UnplacedReason;
    if (rankedSources.length === 0) {
      reason = "NO_SOURCE_SHEET";
    } else if (!rankedSources.some((s) => couldEverFit(instance, s, config, rotations))) {
      reason = "PART_TOO_LARGE";
    } else if (!hasRemainingCapacity()) {
      reason = "INSUFFICIENT_SOURCE_QTY";
    } else {
      reason = "INSUFFICIENT_SHEET_AREA";
    }
    if (!failureReasonByPart.has(instance.takeoffPartId)) {
      failureReasonByPart.set(instance.takeoffPartId, reason);
    }
  }

  return { sheets, placedCountByPart, failureReasonByPart };
}

// ---------------------------------------------------------------------------
// Phase 2A — GLOBAL LAYOUT QUALITY: fragmentation / usable-remaining-space.
// ---------------------------------------------------------------------------
// A small, bounded, deterministic addition to scoreSheets()'s global
// objective (see SCORE_WEIGHTS.fragmentationWeight). scoreSheets() already
// distinguishes layouts by sheet count / scrap area / cavity area /
// utilization, but two layouts can tie on all of those while leaving very
// differently-shaped leftover space: one contiguous open region is far more
// useful for future parts than the same total area scattered across many
// tiny slivers. This section adds that distinction WITHOUT touching exact
// geometry validation (boundsContain/polygonsOverlap/polygonsMinDistance
// remain completely untouched and authoritative) and WITHOUT any new
// per-candidate recursive optimizer calls.
//
// Approach: rasterize each used sheet onto a FIXED-resolution occupancy
// grid (bounded independent of part count or sheet size -- see
// FRAGMENTATION_GRID_CELLS below), using placement BOUNDING BOXES only
// (scoreSheets() only ever receives bbox placement data anyway, never exact
// polygons -- this is consistent with the rest of this global heuristic).
// Free cells are grouped into 4-connected regions with a simple bounded
// flood fill (at most FRAGMENTATION_GRID_CELLS^2 cells, a small fixed
// constant, regardless of how many parts are on the sheet). Two properties
// of the free space are penalized:
//   - SCATTERED area: free area that is NOT part of the single largest
//     contiguous free region (many small disconnected leftovers instead of
//     one usable pocket).
//   - NARROW area: free area that sits in a region only one grid cell thick
//     in either axis (thin unusable slivers/strips), even if that sliver
//     happens to be the largest region.
// Both are folded into one number, "fragmentationAreaSqm" -- physically
// meaningful (an area, comparable in scale to scrapAreaSqm/cavityAreaSqm)
// and always finite/non-NaN, including for an empty or fully-packed sheet.
//
// Future-fit note: this phase intentionally stops at geometry-only
// fragmentation/usable-space scoring, exactly as the "if using future parts
// is too invasive for this phase" fallback allows. Explicitly checking
// whether representative REMAINING part instances could plausibly fit into
// the surviving free regions (rather than just rewarding contiguity/width)
// is a natural Phase 2B-style refinement on top of this same grid, deferred
// for now.

/** Bounded per-axis grid resolution -- fixed, independent of part/placement count or sheet size. */
const FRAGMENTATION_GRID_CELLS = 20;

interface FragmentationCellSpace {
  cols: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  occupied: Uint8Array; // length cols*rows, row-major
}

function buildOccupancyGrid(sheet: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }): FragmentationCellSpace | null {
  const lengthMm = sheet.lengthMm; // X axis, matches makeWorkingSheet's convention
  const widthMm = sheet.widthMm; // Y axis
  if (!(lengthMm > 0) || !(widthMm > 0)) return null;

  const cols = FRAGMENTATION_GRID_CELLS;
  const rows = FRAGMENTATION_GRID_CELLS;
  const cellWidthMm = lengthMm / cols;
  const cellHeightMm = widthMm / rows;
  const occupied = new Uint8Array(cols * rows);

  // Mark a cell occupied if its CENTER point falls inside any placement's
  // bounding box -- a cheap, bounded (O(cells * placements)) heuristic
  // pre-filter consistent with the rest of this scoring layer; this never
  // substitutes for exact collision validation, which happens elsewhere.
  for (let r = 0; r < rows; r++) {
    const cy = (r + 0.5) * cellHeightMm;
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellWidthMm;
      for (const p of sheet.placements) {
        if (cx >= p.xMm && cx <= p.xMm + p.widthMm && cy >= p.yMm && cy <= p.yMm + p.heightMm) {
          occupied[r * cols + c] = 1;
          break;
        }
      }
    }
  }

  return { cols, rows, cellWidthMm, cellHeightMm, occupied };
}

/**
 * Bounded 4-connected flood fill over the (fixed-size) free-cell grid.
 * Returns one entry per connected free region: its cell count and its
 * bounding extent in cells (used to detect narrow, one-cell-thick slivers).
 * Cost is O(cols*rows), a small fixed constant (FRAGMENTATION_GRID_CELLS^2),
 * never dependent on part/placement count.
 */
function findFreeRegions(grid: FragmentationCellSpace): { cells: number[]; extentCols: number; extentRows: number }[] {
  const { cols, rows, occupied } = grid;
  const visited = new Uint8Array(cols * rows);
  const regions: { cells: number[]; extentCols: number; extentRows: number }[] = [];

  for (let start = 0; start < cols * rows; start++) {
    if (occupied[start] || visited[start]) continue;

    const cells: number[] = [];
    let minC = cols, maxC = -1, minR = rows, maxR = -1;
    const stack = [start];
    visited[start] = 1;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      cells.push(idx);
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;

      const neighbors = [
        r > 0 ? idx - cols : -1,
        r < rows - 1 ? idx + cols : -1,
        c > 0 ? idx - 1 : -1,
        c < cols - 1 ? idx + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && !occupied[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }

    regions.push({ cells, extentCols: maxC - minC + 1, extentRows: maxR - minR + 1 });
  }

  return regions;
}

/**
 * Deterministic, bounded fragmentation/usable-space penalty for ONE sheet,
 * in mm^2 (area units, directly comparable to scrapAreaSqm/cavityAreaSqm
 * before weighting). 0 for an empty sheet, a fully-packed sheet, or any
 * sheet whose free space forms a single non-narrow contiguous region.
 * Always finite and never NaN.
 */
function computeFragmentationAreaSqm(sheet: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }): number {
  const grid = buildOccupancyGrid(sheet);
  if (!grid) return 0;

  const regions = findFreeRegions(grid);
  if (regions.length === 0) return 0; // fully packed (or nothing free)

  let largestCells = 0;
  for (const region of regions) {
    if (region.cells.length > largestCells) largestCells = region.cells.length;
  }

  // A cell belongs to "problematic" free area if its region either (a) is
  // not the single largest free region (SCATTERED), or (b) is only one
  // cell thick in either axis (NARROW) -- a thin strip is unusable for a
  // future part regardless of its total area. Each free cell is counted at
  // most once even if both conditions apply.
  let problematicCells = 0;
  for (const region of regions) {
    const isNarrow = region.extentCols <= 1 || region.extentRows <= 1;
    const isScattered = region.cells.length < largestCells;
    if (isNarrow || isScattered) problematicCells += region.cells.length;
  }

  const cellAreaMm2 = grid.cellWidthMm * grid.cellHeightMm;
  return problematicCells * cellAreaMm2;
}

/**
 * Exported (Phase 2A) so it can be unit-tested directly against hand-built
 * sheets, and reused by scoreSheets() below. Sums the per-sheet
 * fragmentation area (mm^2) across every USED sheet in the layout and
 * returns it in sqm, matching scrapAreaSqm/cavityAreaSqm's units.
 */
export function computeFragmentationScore(
  sheets: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }[],
): number {
  const usedSheets = sheets.filter((s) => s.placements.length > 0);
  let totalMm2 = 0;
  for (const sheet of usedSheets) {
    totalMm2 += computeFragmentationAreaSqm(sheet);
  }
  return totalMm2 / 1_000_000;
}

// ---------------------------------------------------------------------------
// Phase 2B — PART A: COMPACTNESS.
// ---------------------------------------------------------------------------
// How tightly the placed parts on a sheet are grouped together, independent
// of scrap/utilization (which only look at total AREA, not where it sits).
// Two layouts can have identical scrap/utilization/fragmentation while one
// keeps its parts huddled in one corner and the other spreads the exact
// same parts out across the full sheet footprint (e.g. leaving a border of
// dead space on every side instead of one usable edge) -- compactness is
// what tells those apart.
//
// Deliberately bbox-only (no exact polygon collision logic), deterministic,
// and normalized to a dimensionless [0, 1]-ish ratio (occupied FOOTPRINT
// bounding box area / sheet area) so raw sheet size can never dominate the
// score -- a 200x200 sheet and a 2000x2000 sheet with parts occupying the
// same FRACTION of their footprint score identically.
function computeSheetCompactnessRatio(sheet: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }): number {
  if (sheet.placements.length === 0) return 0;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of sheet.placements) {
    if (p.xMm < minX) minX = p.xMm;
    if (p.yMm < minY) minY = p.yMm;
    if (p.xMm + p.widthMm > maxX) maxX = p.xMm + p.widthMm;
    if (p.yMm + p.heightMm > maxY) maxY = p.yMm + p.heightMm;
  }

  const footprintAreaMm2 = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  const sheetAreaMm2 = sheet.widthMm * sheet.lengthMm;
  if (!(sheetAreaMm2 > 0)) return 0;

  return footprintAreaMm2 / sheetAreaMm2;
}

/**
 * Exported (Phase 2B PART A) for direct unit testing and reuse in
 * scoreSheets(). Averages the per-sheet compactness ratio across every USED
 * sheet (so adding more used sheets can't mechanically inflate or deflate
 * the metric). Lower is better (tighter grouping). 0 for an all-empty
 * layout -- always finite, never NaN/Infinity.
 */
export function computeCompactnessScore(
  sheets: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }[],
): number {
  const usedSheets = sheets.filter((s) => s.placements.length > 0);
  if (usedSheets.length === 0) return 0;

  let total = 0;
  for (const sheet of usedSheets) {
    total += computeSheetCompactnessRatio(sheet);
  }
  return total / usedSheets.length;
}

// ---------------------------------------------------------------------------
// Phase 2B — PART B: FUTURE-FIT.
// ---------------------------------------------------------------------------
// Reuses the SAME bounded occupancy grid / free-region flood fill Phase 2A
// already built for fragmentation (buildOccupancyGrid / findFreeRegions --
// no new geometry algorithm, no NFP/Minkowski, no exact-geometry
// involvement whatsoever). For each free region, this asks a cheap,
// bounded question: could ANY remaining (distinct) part's bounding box
// plausibly fit here, in either axis-aligned orientation (unrotated or
// swapped 90 degrees -- a coarse stand-in for "some rotation might work",
// consistent with this being a heuristic score, not a placement attempt)?
// A free region that no remaining part could plausibly fit into is
// penalized as wasted/unusable space, in the same area units (sqm) as
// fragmentationAreaSqm, so the two terms combine on a comparable scale.
//
// Bounded: at most MAX_FUTURE_FIT_REPRESENTATIVE_PARTS distinct part
// shapes are checked against at most FRAGMENTATION_GRID_CELLS^2 regions per
// sheet -- fixed, small constants, independent of instance QUANTITY or how
// many parts remain. Never places anything, never mutates `sheets`, never
// touches wall-clock time, and is fully deterministic (same geometry +
// same remaining-part list => same score, every time).
interface RepresentativeDims {
  width: number;
  height: number;
}

function representativePartDims(remainingParts: OptimizerPartInstance[], cap: number): RepresentativeDims[] {
  const seen = new Set<string>();
  const dims: RepresentativeDims[] = [];
  for (const part of remainingParts) {
    if (seen.has(part.takeoffPartId)) continue;
    seen.add(part.takeoffPartId);
    const bbox = computeBoundingBox(part.outer);
    if (bbox.width > 0 && bbox.height > 0) dims.push({ width: bbox.width, height: bbox.height });
    if (dims.length >= cap) break;
  }
  return dims;
}

function regionCouldFitAnyPart(regionWidthMm: number, regionHeightMm: number, partDims: RepresentativeDims[]): boolean {
  for (const d of partDims) {
    if (d.width <= regionWidthMm + 1e-6 && d.height <= regionHeightMm + 1e-6) return true;
    if (d.height <= regionWidthMm + 1e-6 && d.width <= regionHeightMm + 1e-6) return true; // 90-degree swap
  }
  return false;
}

function computeSheetFutureFitPenaltyMm2(
  sheet: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] },
  partDims: RepresentativeDims[],
): number {
  if (partDims.length === 0) return 0; // nothing to check against -- no penalty, not a NaN/undefined result

  const grid = buildOccupancyGrid(sheet);
  if (!grid) return 0;

  const regions = findFreeRegions(grid);
  if (regions.length === 0) return 0;

  const cellAreaMm2 = grid.cellWidthMm * grid.cellHeightMm;
  let penaltyCells = 0;
  for (const region of regions) {
    const regionWidthMm = region.extentCols * grid.cellWidthMm;
    const regionHeightMm = region.extentRows * grid.cellHeightMm;
    if (!regionCouldFitAnyPart(regionWidthMm, regionHeightMm, partDims)) {
      penaltyCells += region.cells.length;
    }
  }
  return penaltyCells * cellAreaMm2;
}

/**
 * Exported (Phase 2B PART B) for direct unit testing and reuse in
 * scoreSheets(). `remainingParts` supplies the actual remaining part
 * geometry (bounding-box dimensions only -- works for rectangles AND
 * irregular/concave outlines alike, since it's driven by computeBoundingBox
 * rather than any shape assumption). Returns the total "unusable-by-any-
 * remaining-part" free area (sqm) across every used sheet. Lower is better.
 * An empty `remainingParts` list (or an all-empty layout) returns 0, never
 * NaN/Infinity.
 */
export function computeFutureFitScore(
  sheets: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }[],
  remainingParts: OptimizerPartInstance[],
): number {
  const partDims = representativePartDims(remainingParts, MAX_FUTURE_FIT_REPRESENTATIVE_PARTS);
  if (partDims.length === 0) return 0;

  const usedSheets = sheets.filter((s) => s.placements.length > 0);
  let totalMm2 = 0;
  for (const sheet of usedSheets) {
    totalMm2 += computeSheetFutureFitPenaltyMm2(sheet, partDims);
  }
  return totalMm2 / 1_000_000;
}

export function scoreSheets(
  sheets: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }[],
  areaByPartId: Map<string, number>,
  remainingParts: OptimizerPartInstance[] = [],
): number {
  const usedSheets = sheets.filter((s) => s.placements.length > 0);
  let totalSheetAreaSqm = 0;
  let totalUsedAreaSqm = 0;
  let cavityAreaSqm = 0;

  for (const sheet of usedSheets) {
    totalSheetAreaSqm += (sheet.widthMm * sheet.lengthMm) / 1_000_000;
    for (const p of sheet.placements) {
      const trueArea = areaByPartId.get(p.takeoffPartId) ?? 0;
      totalUsedAreaSqm += trueArea;
      const bboxAreaSqm = (p.widthMm * p.heightMm) / 1_000_000;
      cavityAreaSqm += Math.max(0, bboxAreaSqm - trueArea);
    }
  }

  const scrapAreaSqm = Math.max(0, totalSheetAreaSqm - totalUsedAreaSqm);
  const utilizationPercent = totalSheetAreaSqm > 0 ? (totalUsedAreaSqm / totalSheetAreaSqm) * 100 : 0;
  const fragmentationAreaSqm = computeFragmentationScore(sheets);
  const compactnessRatio = computeCompactnessScore(sheets);
  const futureFitAreaSqm = computeFutureFitScore(sheets, remainingParts);

  return (
    usedSheets.length * SCORE_WEIGHTS.sheetCountPenalty +
    scrapAreaSqm * SCORE_WEIGHTS.scrapAreaWeight +
    cavityAreaSqm * SCORE_WEIGHTS.cavityAreaWeight -
    utilizationPercent * SCORE_WEIGHTS.utilizationBonusWeight +
    fragmentationAreaSqm * SCORE_WEIGHTS.fragmentationWeight +
    compactnessRatio * SCORE_WEIGHTS.compactnessWeight +
    futureFitAreaSqm * SCORE_WEIGHTS.futureFitWeight
  );
}

/**
 * `remainingParts` (Phase 2B) is the set of distinct part shapes used to
 * derive computeFutureFitScore's signal -- see buildRepresentativeInstances
 * below for how callers within this file source it from the maps they
 * already have on hand (outerByPartId/areaByPartId), so no new plumbing of
 * the full per-instance list is required through localImprovement /
 * ruinAndRecreate. Defaults to [] (future-fit contributes 0) so every
 * existing external caller of scoreLayout-shaped scoring (there are none
 * outside this file; external callers use scoreSheets directly, which has
 * its own default) keeps working unchanged.
 */
function scoreLayout(sheets: WorkingSheet[], areaByPartId: Map<string, number>, remainingParts: OptimizerPartInstance[] = []): number {
  return scoreSheets(sheets, areaByPartId, remainingParts);
}

/**
 * Phase 2B — builds a small, deterministic, deduped set of "remaining part"
 * stand-ins directly from the maps every scoreLayout() caller in this file
 * already has (outerByPartId/areaByPartId), for computeFutureFitScore. One
 * representative instance per distinct takeoffPartId (instanceNumber is
 * irrelevant here -- only the outer shape/bbox matters), capped so this
 * stays cheap regardless of how many types or instances exist.
 */
function buildRepresentativeInstances(outerByPartId: Map<string, Point[]>, areaByPartId: Map<string, number>): OptimizerPartInstance[] {
  const result: OptimizerPartInstance[] = [];
  for (const [takeoffPartId, outer] of outerByPartId) {
    result.push({
      takeoffPartId,
      itemNo: 0,
      instanceNumber: 0,
      areaSqm: areaByPartId.get(takeoffPartId) ?? 0,
      outer,
    });
    if (result.length >= MAX_FUTURE_FIT_REPRESENTATIVE_PARTS) break;
  }
  return result;
}

function summarizeSheets(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
): { sheetsUsed: number; utilizationPercent: number; scrapAreaSqm: number } {
  const used = sheets.filter((s) => s.placements.length > 0);
  let totalSheetAreaSqm = 0;
  let totalUsedAreaSqm = 0;
  for (const sheet of used) {
    totalSheetAreaSqm += (sheet.widthMm * sheet.lengthMm) / 1_000_000;
    for (const p of sheet.placements) totalUsedAreaSqm += areaByPartId.get(p.takeoffPartId) ?? 0;
  }
  const scrapAreaSqm = Math.max(0, totalSheetAreaSqm - totalUsedAreaSqm);
  const utilizationPercent = totalSheetAreaSqm > 0 ? (totalUsedAreaSqm / totalSheetAreaSqm) * 100 : 0;
  return { sheetsUsed: used.length, utilizationPercent, scrapAreaSqm };
}

function edgeLengthMax(outer: Point[]): number {
  let max = 0;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > max) max = len;
  }
  return max;
}

function bboxArea(outer: Point[]): number {
  const b = computeBoundingBox(outer);
  return b.width * b.height;
}

function bboxMaxDim(outer: Point[]): number {
  const b = computeBoundingBox(outer);
  return Math.max(b.width, b.height);
}

function irregularity(instance: OptimizerPartInstance): number {
  return bboxArea(instance.outer) / 1_000_000 - instance.areaSqm;
}

function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function stableTieBreak(a: OptimizerPartInstance, b: OptimizerPartInstance): number {
  if (a.itemNo !== b.itemNo) return a.itemNo - b.itemNo;
  return a.instanceNumber - b.instanceNumber;
}

function buildStrategies(instances: OptimizerPartInstance[], seed: number): { name: string; order: OptimizerPartInstance[] }[] {
  const rngA = mulberry32(seed + 1);
  const rngB = mulberry32(seed + 2);

  return [
    { name: "largest-area-first", order: [...instances].sort((a, b) => b.areaSqm - a.areaSqm || stableTieBreak(a, b)) },
    { name: "longest-edge-first", order: [...instances].sort((a, b) => edgeLengthMax(b.outer) - edgeLengthMax(a.outer) || stableTieBreak(a, b)) },
    { name: "largest-bounding-box-first", order: [...instances].sort((a, b) => bboxArea(b.outer) - bboxArea(a.outer) || stableTieBreak(a, b)) },
    { name: "most-constrained-first", order: [...instances].sort((a, b) => bboxMaxDim(b.outer) - bboxMaxDim(a.outer) || stableTieBreak(a, b)) },
    { name: "irregular-shapes-first", order: [...instances].sort((a, b) => irregularity(b) - irregularity(a) || stableTieBreak(a, b)) },
    {
      name: "rotated-first-variant",
      order: [...instances].sort((a, b) => {
        const shortA = Math.min(computeBoundingBox(a.outer).width, computeBoundingBox(a.outer).height);
        const shortB = Math.min(computeBoundingBox(b.outer).width, computeBoundingBox(b.outer).height);
        return shortB - shortA || stableTieBreak(a, b);
      }),
    },
    { name: "randomized-order-1", order: seededShuffle(instances, rngA) },
    { name: "randomized-order-2", order: seededShuffle(instances, rngB) },
  ];
}

/**
 * Phase 2 — bounded, seeded perturbation of an existing part order: a fixed
 * number of random pairwise swaps applied on top of one of the 8 heuristic
 * orders. This is what makes the extra multi-start layouts "meaningfully
 * different, not merely the same deterministic strategy repeated" (they
 * start from a real heuristic but explore nearby orderings), while staying
 * bounded (fixed swap count, no unbounded loop) and fully deterministic
 * given the same rng.
 */
function perturbOrder<T>(order: T[], rng: () => number, swapCount: number): T[] {
  const arr = order.slice();
  if (arr.length < 2) return arr;
  for (let i = 0; i < swapCount; i++) {
    const a = Math.floor(rng() * arr.length);
    const b = Math.floor(rng() * arr.length);
    [arr[a], arr[b]] = [arr[b], arr[a]];
  }
  return arr;
}

/**
 * Phase 2 — additional seeded/randomized/perturbed construction starts on
 * top of the 8 fixed strategies from buildStrategies(). Each extra start
 * takes one of the fixed heuristic orders as a base and applies a bounded,
 * seeded perturbation, so it explores a genuinely different complete
 * ordering rather than duplicating a fixed strategy outright. `count` is a
 * hard cap (bounded, no unbounded loop); the caller-side construction time
 * budget is what actually decides how many of these get evaluated.
 */
function buildExtraStartStrategies(
  instances: OptimizerPartInstance[],
  baseStrategies: { name: string; order: OptimizerPartInstance[] }[],
  seed: number,
  count: number,
): { name: string; order: OptimizerPartInstance[] }[] {
  if (count <= 0 || instances.length < 2 || baseStrategies.length === 0) return [];
  const swapBase = Math.max(1, Math.floor(instances.length * 0.15));
  const extra: { name: string; order: OptimizerPartInstance[] }[] = [];
  for (let i = 0; i < count; i++) {
    // Distinct, deterministic seed per extra start — "different construction
    // seeds" from the spec — offset well clear of the seeds buildStrategies()
    // already uses (seed+1, seed+2) so the two never collide/correlate.
    const rng = mulberry32(seed + 9001 + i * 97);
    const base = baseStrategies[i % baseStrategies.length];
    const swaps = Math.max(1, Math.min(instances.length, swapBase + (i % 3)));
    extra.push({
      name: `multistart-${i}-perturbed-${base.name}`,
      order: perturbOrder(base.order, rng, swaps),
    });
  }
  return extra;
}

export interface LayoutQuality {
  placedTotal: number;
  score: number;
}

/**
 * Phase 2 — global candidate-layout comparison (spec item 5).
 *
 * A layout placing fewer required instances must NEVER beat one placing
 * more, no matter how much better its raw scoreLayout() value is — this is
 * what stops an empty/partial candidate from looking artificially good
 * because of the sheet-count penalty term inside scoreLayout(). Only once
 * placed counts are equal does the (lower-is-better) global score decide;
 * ties beyond that fall through to whatever deterministic order the caller
 * iterates candidates in (fixed strategy list order, so "first found" is a
 * stable, reproducible tie-break).
 *
 * Exported (in addition to being used internally) so it can be unit-tested
 * directly against hand-built placed-count/score pairs.
 */
export function isBetterLayout(candidate: LayoutQuality, current: LayoutQuality | null): boolean {
  if (!current) return true;
  if (candidate.placedTotal !== current.placedTotal) return candidate.placedTotal > current.placedTotal;
  return candidate.score < current.score - 1e-6;
}

function totalPlaced(sheets: WorkingSheet[]): number {
  return sheets.reduce((sum, s) => sum + s.placements.length, 0);
}

/**
 * Phase 2B PART E — a single relocate-one-part improvement pass (the
 * original, unchanged single-pass logic from Fix 1 / Phase 1). Exported
 * name `localImprovement` is preserved as the bounded, iterative wrapper
 * below; this is the pass it repeats.
 */
function localImprovementPass(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  deadline: number,
  rng: () => number,
  rotations: RotationCandidateCache,
  remainingParts: OptimizerPartInstance[],
  packingPreference: PackingPreference = "AUTO",
): { sheets: WorkingSheet[]; moves: number; trialsEvaluated: number } {
  let working = cloneLayout(sheets);
  let bestScore = scoreLayout(working, areaByPartId, remainingParts);
  let moves = 0;
  let trialsEvaluated = 0;

  let targets: { sheetIdx: number; placementIdx: number }[] = [];
  working.forEach((sheet, sheetIdx) => {
    sheet.placements.forEach((_, placementIdx) => targets.push({ sheetIdx, placementIdx }));
  });
  targets = seededShuffle(targets, rng);

  for (const t of targets) {
    if (Date.now() > deadline) break;
    trialsEvaluated++;

    const trial = cloneLayout(working);
    const originSheet = trial[t.sheetIdx];
    const removedPlacement = originSheet.placements[t.placementIdx];
    const removedPolygon = originSheet.polygons[t.placementIdx];
    if (!removedPlacement || !removedPolygon) continue;

    originSheet.placements.splice(t.placementIdx, 1);
    originSheet.polygons.splice(t.placementIdx, 1);

    const originalOuter = outerByPartId.get(removedPlacement.takeoffPartId) ?? removedPolygon;
    const asInstance: OptimizerPartInstance = {
      takeoffPartId: removedPlacement.takeoffPartId,
      itemNo: 0,
      instanceNumber: removedPlacement.instanceNumber,
      areaSqm: areaByPartId.get(removedPlacement.takeoffPartId) ?? 0,
      outer: originalOuter,
    };

    // Fix 1 — compare relocation candidates gathered from MULTIPLE separate
    // findBestPlacement() calls (one per candidate sheet) using the exact
    // same placement-quality ranking rule findBestPlacement() itself uses
    // internally (comparePlacementQuality: score, then Y, then X, then
    // rotation), instead of the old "lower Y, then lower X" shortcut that
    // could discard a genuinely better-scored placement just because it
    // sat slightly higher on a different sheet. Only replacing `relocated`
    // on a STRICT improvement (cmp < 0) — combined with iterating sheets in
    // their fixed order — makes "first sheet evaluated wins a tie" the
    // deterministic tie-break, with no extra bookkeeping required.
    let relocated: { sheetIdx: number; attempt: PlacementAttempt } | null = null;
    trial.forEach((candidateSheet, sIdx) => {
      const attempt = findBestPlacement(asInstance, candidateSheet, config, maxCandidates, rotations, packingPreference);
      if (!attempt) return;
      if (!relocated || comparePlacementQuality(attempt, relocated.attempt) < 0) {
        relocated = { sheetIdx: sIdx, attempt };
      }
    });

    if (!relocated) {
      originSheet.placements.splice(t.placementIdx, 0, removedPlacement);
      originSheet.polygons.splice(t.placementIdx, 0, removedPolygon);
      continue;
    }

    const r: { sheetIdx: number; attempt: PlacementAttempt } = relocated;
    commitPlacement(trial[r.sheetIdx], asInstance, r.attempt);

    // PART E requirement: a relocation only ever moves an ALREADY-placed
    // part to another valid spot (exact-geometry validated inside
    // findBestPlacement) — it can never drop a part, so placed required
    // quantity is structurally preserved across every pass, with no extra
    // bookkeeping needed here.
    const trialScore = scoreLayout(trial, areaByPartId, remainingParts);
    if (trialScore < bestScore - 1e-6) {
      working = trial;
      bestScore = trialScore;
      moves++;
    }
  }

  return { sheets: working, moves, trialsEvaluated };
}

/**
 * Phase 2B PART E — bounded ITERATIVE local improvement: repeats
 * localImprovementPass() up to MAX_LOCAL_IMPROVEMENT_PASSES times,
 * stopping as soon as a pass makes zero moves (no further improvement
 * found) or the shared deadline is reached — whichever comes first. Each
 * pass starts from the previous pass's result, so a relocation in pass 1
 * can open up a genuinely better spot for a different part in pass 2 that
 * wasn't available before. Deterministic: the same seed/rng sequence drives
 * every pass in the same fixed order, with no randomness beyond the
 * existing seeded shuffle already used per pass.
 */
export function localImprovement(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  deadline: number,
  rng: () => number,
  rotations: RotationCandidateCache,
  packingPreference: PackingPreference = "AUTO",
): { sheets: WorkingSheet[]; moves: number; trialsEvaluated: number } {
  const remainingParts = buildRepresentativeInstances(outerByPartId, areaByPartId);

  let working = sheets;
  let totalMoves = 0;
  let totalTrials = 0;

  for (let pass = 0; pass < MAX_LOCAL_IMPROVEMENT_PASSES; pass++) {
    if (Date.now() > deadline) break;

    const result = localImprovementPass(working, areaByPartId, outerByPartId, config, maxCandidates, deadline, rng, rotations, remainingParts, packingPreference);
    working = result.sheets;
    totalMoves += result.moves;
    totalTrials += result.trialsEvaluated;

    if (result.moves === 0) break; // converged — no further passes needed
  }

  return { sheets: working, moves: totalMoves, trialsEvaluated: totalTrials };
}

// ---------------------------------------------------------------------------
// Phase 3 — ADVANCED SEARCH / ALNS-STYLE OPTIMIZATION.
// ---------------------------------------------------------------------------
// This section replaces the old fixed/simple ruin-and-recreate loop with a
// small, bounded, deterministic Adaptive Large Neighborhood Search style
// layer on top of the SAME building blocks Phase 1/2 already validated:
// findBestPlacement() (exact geometry, unchanged), scoreLayout()/scoreSheets()
// (Phase 2A/2B score, unchanged), and commitPlacement(). Nothing in this
// section performs its own geometry validation -- every reconstructed
// placement still goes through findBestPlacement()'s existing exact bounds/
// overlap/gap checks. This is a genuinely improved SEARCH STRATEGY, not a
// geometry engine change, and it is NOT a full academic ALNS implementation
// (no learned operator selection, no destroy-degree annealing schedules from
// the literature) -- it is a simple, bounded, weighted-adaptive version of
// the same idea, sized to fit this codebase.

/** PART C — the ruin operators this phase implements. */
export type RuinOperatorName = "RANDOM_RUIN" | "WORST_PLACEMENT_RUIN" | "CLUSTER_RUIN" | "SHEET_RUIN" | "LARGE_PART_RUIN";

export const RUIN_OPERATOR_NAMES: RuinOperatorName[] = ["RANDOM_RUIN", "WORST_PLACEMENT_RUIN", "CLUSTER_RUIN", "SHEET_RUIN", "LARGE_PART_RUIN"];

/** PART D — bounded ruin-size tiers, expressed as a fraction of total placed instances (not magic numbers inline in the algorithm). */
export const RUIN_SIZE_TIERS: Record<"small" | "medium" | "large", [number, number]> = {
  small: [0.05, 0.1],
  medium: [0.1, 0.2],
  large: [0.2, 0.35],
};
export const RUIN_SIZE_TIER_NAMES: (keyof typeof RUIN_SIZE_TIERS)[] = ["small", "medium", "large"];
/** Hard absolute cap on ruin size regardless of the fractional tier -- keeps a single iteration's remove+reconstruct work bounded even for very large jobs. */
const RUIN_SIZE_ABSOLUTE_CAP = 24;

/**
 * PART D — turns a ruin-size TIER into a concrete, bounded, clamped instance
 * count for this call. Deterministic given `rng` (draws exactly one value).
 */
export function computeRuinSize(tier: keyof typeof RUIN_SIZE_TIERS, totalPlacements: number, rng: () => number): number {
  if (totalPlacements <= 0) return 0;
  const [minFrac, maxFrac] = RUIN_SIZE_TIERS[tier];
  const frac = minFrac + rng() * (maxFrac - minFrac);
  const raw = Math.round(totalPlacements * frac);
  return Math.max(1, Math.min(totalPlacements, RUIN_SIZE_ABSOLUTE_CAP, raw));
}

interface FlatPlacementRef {
  sheetIdx: number;
  placementIdx: number;
}

function flattenPlacements(sheets: WorkingSheet[]): FlatPlacementRef[] {
  const flat: FlatPlacementRef[] = [];
  sheets.forEach((s, sIdx) => s.placements.forEach((_, pIdx) => flat.push({ sheetIdx: sIdx, placementIdx: pIdx })));
  return flat;
}

function refBBoxArea(sheets: WorkingSheet[], ref: FlatPlacementRef): number {
  const p = sheets[ref.sheetIdx].placements[ref.placementIdx];
  return p.widthMm * p.heightMm;
}

function refCenter(sheets: WorkingSheet[], ref: FlatPlacementRef): { x: number; y: number } {
  const p = sheets[ref.sheetIdx].placements[ref.placementIdx];
  return { x: p.xMm + p.widthMm / 2, y: p.yMm + p.heightMm / 2 };
}

/**
 * PART C — selects WHICH placements a given ruin operator would remove, as a
 * flat, bounded, deterministic list of refs. Does NOT mutate `sheets` and
 * does NOT itself remove anything -- the caller (adaptiveRuinAndRecreate)
 * performs the actual removal, exactly as the pre-Phase-3 code did, so
 * "never mutate the original solution unexpectedly" holds by construction.
 * Exported for direct, focused unit testing of each operator in isolation.
 */
export function selectRuinTargets(
  operator: RuinOperatorName,
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  ruinSize: number,
  rng: () => number,
): FlatPlacementRef[] {
  const flat = flattenPlacements(sheets);
  if (flat.length === 0 || ruinSize <= 0) return [];
  const size = Math.min(ruinSize, flat.length);

  switch (operator) {
    case "RANDOM_RUIN": {
      // A deterministic seeded random subset -- the general-purpose
      // "diversify anywhere" operator.
      return seededShuffle(flat, rng).slice(0, size);
    }

    case "WORST_PLACEMENT_RUIN": {
      // Ranks by CAVITY (bbox area minus true part area) descending --
      // placements contributing the most wasted bounding-box space to the
      // layout's cavityArea score term are the "worst contributors" and are
      // removed first, deterministic tie-break by (sheetIdx, placementIdx).
      const ranked = [...flat].sort((a, b) => {
        const pa = sheets[a.sheetIdx].placements[a.placementIdx];
        const pb = sheets[b.sheetIdx].placements[b.placementIdx];
        const cavityA = pa.widthMm * pa.heightMm - (areaByPartId.get(pa.takeoffPartId) ?? 0) * 1_000_000;
        const cavityB = pb.widthMm * pb.heightMm - (areaByPartId.get(pb.takeoffPartId) ?? 0) * 1_000_000;
        if (cavityB !== cavityA) return cavityB - cavityA;
        return a.sheetIdx !== b.sheetIdx ? a.sheetIdx - b.sheetIdx : a.placementIdx - b.placementIdx;
      });
      return ranked.slice(0, size);
    }

    case "CLUSTER_RUIN": {
      // Pick a deterministic seeded anchor placement, then take the `size`
      // placements whose centers are spatially closest to it (Euclidean
      // distance between bbox centers) -- a spatially CONCENTRATED region,
      // not a scattered random subset.
      const anchorIdx = Math.floor(rng() * flat.length) % flat.length;
      const anchor = refCenter(sheets, flat[anchorIdx]);
      const ranked = [...flat].sort((a, b) => {
        const ca = refCenter(sheets, a);
        const cb = refCenter(sheets, b);
        const da = (ca.x - anchor.x) ** 2 + (ca.y - anchor.y) ** 2;
        const db = (cb.x - anchor.x) ** 2 + (cb.y - anchor.y) ** 2;
        if (da !== db) return da - db;
        return a.sheetIdx !== b.sheetIdx ? a.sheetIdx - b.sheetIdx : a.placementIdx - b.placementIdx;
      });
      return ranked.slice(0, size);
    }

    case "SHEET_RUIN": {
      // Pick ONE used sheet (deterministic seeded choice among used sheets)
      // and take up to `size` of ITS placements -- "attempt to rebuild one
      // sheet". If that sheet has fewer than `size` placements, the whole
      // sheet is selected (its own natural bound).
      const usedSheetIdxs = sheets.map((s, i) => i).filter((i) => sheets[i].placements.length > 0);
      if (usedSheetIdxs.length === 0) return [];
      const chosen = usedSheetIdxs[Math.floor(rng() * usedSheetIdxs.length) % usedSheetIdxs.length];
      const onSheet = flat.filter((r) => r.sheetIdx === chosen);
      // Deterministic seeded subset of that one sheet when it has more
      // placements than the ruin size budget allows.
      return seededShuffle(onSheet, rng).slice(0, Math.min(size, onSheet.length));
    }

    case "LARGE_PART_RUIN": {
      // Ranks by bounding-box area descending -- the largest/most awkward
      // placements (hardest to re-place well) are removed first.
      const ranked = [...flat].sort((a, b) => {
        const diff = refBBoxArea(sheets, b) - refBBoxArea(sheets, a);
        if (diff !== 0) return diff;
        return a.sheetIdx !== b.sheetIdx ? a.sheetIdx - b.sheetIdx : a.placementIdx - b.placementIdx;
      });
      return ranked.slice(0, size);
    }

    default: {
      const _exhaustive: never = operator;
      return _exhaustive;
    }
  }
}

/** PART G — lightweight per-operator statistics used to adapt operator selection. */
export interface RuinOperatorStats {
  attempts: number;
  accepted: number;
  improvements: number;
  bestImprovements: number;
}

function initRuinOperatorStats(): Record<RuinOperatorName, RuinOperatorStats> {
  const stats = {} as Record<RuinOperatorName, RuinOperatorStats>;
  for (const name of RUIN_OPERATOR_NAMES) stats[name] = { attempts: 0, accepted: 0, improvements: 0, bestImprovements: 0 };
  return stats;
}

/**
 * PART G — a simple, bounded, DETERMINISTIC weighted selection: every
 * operator starts with an equal base weight of 1 (so an untried operator
 * always has a real chance), and gains weight for every accepted move and
 * more for every move that struck a new global-best solution. No learning
 * system, just roulette-wheel selection over a bounded weight formula.
 * Deterministic given the position in the `rng` sequence -- same stats +
 * same next rng draw => same operator, every time (PART L test 19).
 */
export function selectRuinOperator(stats: Record<RuinOperatorName, RuinOperatorStats>, rng: () => number): RuinOperatorName {
  const weights = RUIN_OPERATOR_NAMES.map((name) => {
    const s = stats[name];
    return 1 + s.accepted * 1 + s.improvements * 2 + s.bestImprovements * 3;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < RUIN_OPERATOR_NAMES.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RUIN_OPERATOR_NAMES[i];
  }
  return RUIN_OPERATOR_NAMES[RUIN_OPERATOR_NAMES.length - 1];
}

/** PART E — the reconstruction (reinsertion order) strategies this phase implements. */
export type ReconstructionStrategyName = "BEST_QUALITY_FIRST" | "LARGEST_FIRST" | "MOST_CONSTRAINED_FIRST" | "ROTATION_DIVERSIFIED" | "RANDOMIZED_DETERMINISTIC";

export const RECONSTRUCTION_STRATEGY_NAMES: ReconstructionStrategyName[] = [
  "BEST_QUALITY_FIRST",
  "LARGEST_FIRST",
  "MOST_CONSTRAINED_FIRST",
  "ROTATION_DIVERSIFIED",
  "RANDOMIZED_DETERMINISTIC",
];

/**
 * PART E — orders a batch of just-removed instances for reinsertion. This
 * only decides ORDER; the actual placement search/validation for every
 * single instance still goes exclusively through findBestPlacement() in
 * adaptiveRuinAndRecreate() below (PART E: "do not bypass findBestPlacement
 * or duplicate geometry logic").
 */
export function orderForReconstruction(
  strategy: ReconstructionStrategyName,
  removed: { instance: OptimizerPartInstance; polygon: Point[] }[],
  rng: () => number,
): { instance: OptimizerPartInstance; polygon: Point[] }[] {
  switch (strategy) {
    case "LARGEST_FIRST":
      // Largest bounding-box area first -- the original Phase 1/2 default:
      // biggest/hardest-to-place parts get first pick of the free space.
      return [...removed].sort((a, b) => bboxArea(b.instance.outer) - bboxArea(a.instance.outer));

    case "MOST_CONSTRAINED_FIRST":
      // Most irregular (worst bbox-fill ratio) shapes first -- these are
      // typically the hardest to place well once space gets tight.
      return [...removed].sort((a, b) => irregularity(b.instance) - irregularity(a.instance));

    case "BEST_QUALITY_FIRST":
      // Longest single edge first -- a different "hard parts first" proxy
      // (long thin parts are awkward to tuck in late), giving reconstruction
      // a genuinely different ordering heuristic from LARGEST_FIRST.
      return [...removed].sort((a, b) => edgeLengthMax(b.instance.outer) - edgeLengthMax(a.instance.outer));

    case "ROTATION_DIVERSIFIED":
      // Interleaves large and small parts (alternating from both ends of
      // the bbox-area-sorted list) instead of strictly largest-to-smallest,
      // so reconstruction doesn't always greedily burn the best spots on
      // the very largest parts first -- a lightweight diversification of
      // the placement ORDER, complementing findBestPlacement's own
      // already-exhaustive per-instance rotation search.
      {
        const byArea = [...removed].sort((a, b) => bboxArea(b.instance.outer) - bboxArea(a.instance.outer));
        const interleaved: typeof removed = [];
        let lo = 0, hi = byArea.length - 1;
        let takeFromStart = true;
        while (lo <= hi) {
          if (takeFromStart) interleaved.push(byArea[lo++]);
          else interleaved.push(byArea[hi--]);
          takeFromStart = !takeFromStart;
        }
        return interleaved;
      }

    case "RANDOMIZED_DETERMINISTIC":
      // A deterministic seeded shuffle -- the "just try a different order"
      // fallback strategy.
      return seededShuffle(removed, rng);

    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

/** PART A/J — one retained solution in the bounded pool. */
export interface PoolSolution {
  sheets: WorkingSheet[];
  quality: LayoutQuality;
  signature: string;
}

/**
 * PART J — a lightweight, deterministic signature for duplicate detection
 * ONLY (never used for scoring or geometry). Coordinates are rounded to
 * 0.01mm purely for this string -- the actual placement coordinates stored
 * on the solution are completely untouched.
 */
export function buildSolutionSignature(sheets: WorkingSheet[]): string {
  const parts: string[] = [];
  sheets.forEach((sheet, sheetIdx) => {
    for (const p of sheet.placements) {
      const rx = Math.round(p.xMm * 100) / 100;
      const ry = Math.round(p.yMm * 100) / 100;
      parts.push(`${sheetIdx}|${p.takeoffPartId}|${p.instanceNumber}|${rx}|${ry}|${p.rotationDeg}`);
    }
  });
  parts.sort();
  return parts.join(";");
}

function compareLayoutQuality(a: LayoutQuality, b: LayoutQuality): number {
  if (a.placedTotal !== b.placedTotal) return b.placedTotal - a.placedTotal; // more placed first
  return a.score - b.score; // lower score first
}

/**
 * PART A — inserts `candidateSheets` into the bounded solution pool if (and
 * only if) it is not a duplicate of an already-retained solution (PART J),
 * then re-sorts (placed-count-first, PART A requirement) and caps at
 * `maxSolutions`. Because the pool is always kept sorted best-first and then
 * truncated from the back, the single best-ever solution (pool[0]) can never
 * be evicted by this operation -- "preserve the global best solution".
 * Returns a NEW array; never mutates `pool` in place.
 */
export function updateSolutionPool(pool: PoolSolution[], candidateSheets: WorkingSheet[], quality: LayoutQuality, maxSolutions: number): PoolSolution[] {
  const signature = buildSolutionSignature(candidateSheets);
  if (pool.some((p) => p.signature === signature)) return pool;

  const next = [...pool, { sheets: cloneLayout(candidateSheets), quality, signature }];
  next.sort((a, b) => compareLayoutQuality(a.quality, b.quality));
  return next.slice(0, Math.max(1, maxSolutions));
}

// PART F — bounded threshold-acceptance constants (simple, not a full
// simulated-annealing cooling schedule). `progressFraction` is 0 at the
// start of the ruin-and-recreate budget and approaches 1 near its end, so
// both the acceptable-worse-score threshold and the acceptance probability
// shrink toward 0 over the course of the search.
const ACCEPTANCE_INITIAL_RELATIVE_THRESHOLD = 0.02; // up to ~2% relatively worse, early on
const ACCEPTANCE_PROBABILITY_NEAR_THRESHOLD = 0.3;
const ACCEPTANCE_EQUAL_SCORE_PROBABILITY = 0.15; // occasional lateral move, for diversification only

/**
 * PART F — bounded acceptance decision for one ruin-and-recreate trial.
 * Hard, non-negotiable rule first (PART F "IMPORTANT"): a candidate with
 * FEWER placed required parts than `current` is NEVER accepted, regardless
 * of how much better its geometric score is. Otherwise: strictly more
 * placed always wins; among equal placed counts, a strictly better score is
 * always accepted, an equal score is occasionally accepted (bounded,
 * shrinking probability) purely for diversification, and a slightly worse
 * score may be accepted early in the search with a bounded, shrinking
 * probability -- exactly the "occasionally escape a local optimum" ask.
 * Deterministic given `rng`'s next draw.
 */
export function shouldAcceptCandidate(candidate: LayoutQuality, current: LayoutQuality, progressFraction: number, rng: () => number): boolean {
  if (candidate.placedTotal < current.placedTotal) return false;
  if (candidate.placedTotal > current.placedTotal) return true;

  const clampedProgress = Math.max(0, Math.min(1, progressFraction));
  const cooling = 1 - clampedProgress; // 1 at the start, 0 at the end

  if (candidate.score < current.score - 1e-6) return true;

  if (Math.abs(candidate.score - current.score) <= 1e-6) {
    return rng() < ACCEPTANCE_EQUAL_SCORE_PROBABILITY * cooling;
  }

  // candidate.score is worse (higher) than current.score.
  const relativeGap = (candidate.score - current.score) / Math.max(1, Math.abs(current.score));
  const threshold = ACCEPTANCE_INITIAL_RELATIVE_THRESHOLD * cooling;
  if (relativeGap <= threshold) {
    return rng() < ACCEPTANCE_PROBABILITY_NEAR_THRESHOLD * cooling;
  }
  return false;
}

/**
 * Phase 3 — the ALNS-style adaptive search loop. Replaces the old fixed
 * single-operator ruin-and-recreate with:
 *   pick operator (PART G, adaptive+deterministic)
 *     -> pick ruin size tier + size (PART D, bounded)
 *       -> select targets with that operator (PART C)
 *         -> remove them (never mutates the input `sheets`)
 *           -> pick a reconstruction order (PART E)
 *             -> reinsert every removed instance via findBestPlacement
 *                (PART E: exact geometry, unchanged; if ANY instance can't
 *                be reinserted the whole trial is discarded, so required
 *                quantity can never silently drop -- PART C/PART F)
 *               -> score the trial (Phase 2A/2B score, unchanged, PART K)
 *                 -> accept/reject (PART F, bounded threshold acceptance)
 *                   -> update operator stats (PART G) + solution pool (PART A)
 *                     -> track bestSolution independently (PART I)
 * Bounded by BOTH `maxIterations` and `deadline` (PART H); every operator,
 * ruin size, and pool size is itself bounded (PART D/A), so total work per
 * call is bounded regardless of job size.
 */
export function adaptiveRuinAndRecreate(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  maxIterations: number,
  maxSolutions: number,
  deadline: number,
  searchStartedAt: number,
  rng: () => number,
  rotations: RotationCandidateCache,
  packingPreference: PackingPreference = "AUTO",
): {
  sheets: WorkingSheet[];
  iterations: number;
  accepted: number;
  improvements: number;
  operatorStats: Record<RuinOperatorName, RuinOperatorStats>;
  poolSize: number;
} {
  const remainingParts = buildRepresentativeInstances(outerByPartId, areaByPartId);
  const operatorStats = initRuinOperatorStats();

  let working = cloneLayout(sheets); // PART F — the current search position (may occasionally be a slightly-worse accepted trial).
  let workingQuality: LayoutQuality = { placedTotal: totalPlaced(working), score: scoreLayout(working, areaByPartId, remainingParts) };

  // PART I — bestSolution is tracked completely independently of `working`
  // and is ONLY ever replaced by a STRICTLY better (never merely accepted)
  // candidate, so a lateral/worse accepted move can never lose the best
  // solution found so far.
  let bestSolution: { sheets: WorkingSheet[]; quality: LayoutQuality } = { sheets: cloneLayout(working), quality: workingQuality };

  // PART A — bounded pool of distinct best solutions, seeded with the
  // starting layout.
  let pool = updateSolutionPool([], working, workingQuality, maxSolutions);

  const totalPlacements = working.reduce((sum, s) => sum + s.placements.length, 0);
  let iterations = 0;
  let accepted = 0;
  let improvements = 0;

  if (totalPlacements < 2) {
    return { sheets: working, iterations: 0, accepted: 0, improvements: 0, operatorStats, poolSize: pool.length };
  }

  const totalBudgetMs = Math.max(1, deadline - searchStartedAt);

  for (let iter = 0; iter < maxIterations; iter++) {
    const now = Date.now();
    if (now > deadline) break;
    iterations++;

    const progressFraction = Math.min(1, (now - searchStartedAt) / totalBudgetMs);

    // PART G — adaptive, deterministic operator choice.
    const operator = selectRuinOperator(operatorStats, rng);
    operatorStats[operator].attempts++;

    // PART D — bounded, adaptive ruin size.
    const tier = RUIN_SIZE_TIER_NAMES[Math.floor(rng() * RUIN_SIZE_TIER_NAMES.length) % RUIN_SIZE_TIER_NAMES.length];
    const currentTotalPlacements = working.reduce((sum, s) => sum + s.placements.length, 0);
    const ruinSize = computeRuinSize(tier, currentTotalPlacements, rng);

    // PART C — select targets (read-only), then remove them from a fresh
    // clone (never mutates `working`/`sheets`).
    const targets = selectRuinTargets(operator, working, areaByPartId, ruinSize, rng);
    if (targets.length === 0) continue;

    const trial = cloneLayout(working);
    const toRemove = [...targets].sort((a, b) => (a.sheetIdx !== b.sheetIdx ? b.sheetIdx - a.sheetIdx : b.placementIdx - a.placementIdx));

    const removed: { instance: OptimizerPartInstance; polygon: Point[] }[] = [];
    for (const r of toRemove) {
      const sheet = trial[r.sheetIdx];
      const [placement] = sheet.placements.splice(r.placementIdx, 1);
      const [polygon] = sheet.polygons.splice(r.placementIdx, 1);
      if (!placement || !polygon) continue;
      const originalOuter = outerByPartId.get(placement.takeoffPartId) ?? polygon;
      removed.push({
        instance: {
          takeoffPartId: placement.takeoffPartId,
          itemNo: 0,
          instanceNumber: placement.instanceNumber,
          areaSqm: areaByPartId.get(placement.takeoffPartId) ?? 0,
          outer: originalOuter,
        },
        polygon,
      });
    }

    // PART E — pick a reconstruction order strategy for this iteration.
    const reconStrategy = RECONSTRUCTION_STRATEGY_NAMES[Math.floor(rng() * RECONSTRUCTION_STRATEGY_NAMES.length) % RECONSTRUCTION_STRATEGY_NAMES.length];
    const ordered = orderForReconstruction(reconStrategy, removed, rng);

    // PART E — every single reinsertion goes through findBestPlacement(),
    // the SAME exact bounds/overlap/gap-validated search used everywhere
    // else in this file. If any removed instance can't be placed anywhere,
    // the ENTIRE trial is discarded (required quantity can never drop).
    let allReinserted = true;
    for (const r of ordered) {
      let placedSomewhere = false;
      for (const sheet of trial) {
        const attempt = findBestPlacement(r.instance, sheet, config, maxCandidates, rotations, packingPreference);
        if (attempt) {
          commitPlacement(sheet, r.instance, attempt);
          placedSomewhere = true;
          break;
        }
      }
      if (!placedSomewhere) {
        allReinserted = false;
        break;
      }
    }
    if (!allReinserted) continue;

    const trialQuality: LayoutQuality = { placedTotal: totalPlaced(trial), score: scoreLayout(trial, areaByPartId, remainingParts) };

    // PART I — independent best-solution tracking: only a STRICT improvement
    // ever replaces bestSolution, regardless of what gets "accepted" below.
    if (isBetterLayout(trialQuality, bestSolution.quality)) {
      bestSolution = { sheets: cloneLayout(trial), quality: trialQuality };
      operatorStats[operator].bestImprovements++;
      improvements++;
    }

    // PART F — bounded threshold acceptance decides the NEXT search
    // position (`working`), independent of the bestSolution bookkeeping
    // above.
    if (shouldAcceptCandidate(trialQuality, workingQuality, progressFraction, rng)) {
      working = trial;
      workingQuality = trialQuality;
      accepted++;
      operatorStats[operator].accepted++;
      // PART A/J — bounded, deduplicated pool of distinct good solutions.
      pool = updateSolutionPool(pool, working, workingQuality, maxSolutions);
    }
  }

  // PART A — the pool must contain the best solution found, even if the
  // very last accepted `working` position was a lateral/worse move kept
  // only for diversification.
  pool = updateSolutionPool(pool, bestSolution.sheets, bestSolution.quality, maxSolutions);

  return { sheets: bestSolution.sheets, iterations, accepted, improvements, operatorStats, poolSize: pool.length };
}

function revalidate(sheets: WorkingSheet[], partGapMm = 0): boolean {
  for (const sheet of sheets) {
    for (let i = 0; i < sheet.polygons.length; i++) {
      if (!boundsContain(sheet.polygons[i], sheet.minX, sheet.minY, sheet.maxX, sheet.maxY)) return false;
      for (let j = i + 1; j < sheet.polygons.length; j++) {
        if (polygonsOverlap(sheet.polygons[i], sheet.polygons[j])) return false;
        if (partGapMm > 0 && polygonsMinDistance(sheet.polygons[i], sheet.polygons[j]) < partGapMm - 1e-6) return false;
      }
    }
  }
  return true;
}

// ----------------------------------------------------------------------------
// Phase 2C integration point — "Optimize Remaining" for an assisted-nesting
// session. Seeds ONE working sheet with the user's manually LOCKED
// placements (never moved, never re-validated as candidates — they are
// simply obstacles the search must route around), then runs the exact same
// candidate-search placement (findBestPlacement / RotationCandidateCache)
// used by the automatic optimizer to fill as many of `remainingInstances`
// as will fit onto that one sheet. Anything left over is returned as
// still-unplaced so the caller can hand it to the ordinary multi-sheet
// optimizeGroupPlacement/runNestingAlgorithm path (fresh sheets, no locked
// geometry) — this is what gives "remaining parts continue automatically,
// opening new sheets if needed" without a second collision/placement
// implementation.
// ----------------------------------------------------------------------------
export interface LockedSeedPlacement {
  takeoffPartId: string;
  instanceNumber: number;
  xMm: number;
  yMm: number;
  rotationDeg: RotationDeg;
  outer: Point[];
}

export interface PackRemainingResult {
  placements: EnginePlacementResult[];
  newlyPlacedCountByPart: Map<string, number>;
  stillUnplaced: OptimizerPartInstance[];
  metrics: OptimizationMetrics;
}

export function packRemainingOntoSeededSheet(
  lockedSeed: LockedSeedPlacement[],
  remainingInstances: OptimizerPartInstance[],
  source: EngineSourceInput,
  config: EngineConfig,
  options?: OptimizerOptions,
): PackRemainingResult {
  const startedAt = Date.now();
  const opts: Required<OptimizerOptions> = { ...DEFAULT_OPTIONS, ...options };
  const rotations = new RotationCandidateCache(opts.rotationStepDeg, opts.maxRotationCandidatesPerPart);

  const areaByPartId = new Map<string, number>();
  const outerByPartId = new Map<string, Point[]>();
  for (const inst of remainingInstances) {
    areaByPartId.set(inst.takeoffPartId, inst.areaSqm);
    outerByPartId.set(inst.takeoffPartId, inst.outer);
  }

  const sheet = makeWorkingSheet(source, config);
  for (const locked of lockedSeed) {
    const shape = computeOrientedShape(locked.outer, locked.rotationDeg);
    const polygon = translatePoints(shape.points, locked.xMm, locked.yMm);
    sheet.placements.push({
      takeoffPartId: locked.takeoffPartId,
      instanceNumber: locked.instanceNumber,
      xMm: locked.xMm,
      yMm: locked.yMm,
      rotationDeg: locked.rotationDeg,
      widthMm: shape.width,
      heightMm: shape.height,
    });
    sheet.polygons.push(polygon);
  }

  const ordered = [...remainingInstances].sort((a, b) => b.areaSqm - a.areaSqm);

  const newlyPlacedCountByPart = new Map<string, number>();
  const stillUnplaced: OptimizerPartInstance[] = [];

  for (const instance of ordered) {
    const attempt = findBestPlacement(instance, sheet, config, opts.maxCandidatesPerPart, rotations, opts.packingPreference);
    if (attempt) {
      commitPlacement(sheet, instance, attempt);
      newlyPlacedCountByPart.set(instance.takeoffPartId, (newlyPlacedCountByPart.get(instance.takeoffPartId) ?? 0) + 1);
    } else {
      stillUnplaced.push(instance);
    }
  }

  if (!revalidate([sheet], config.partGapMm)) {
    return {
      placements: lockedSeed.map((l) => ({
        takeoffPartId: l.takeoffPartId,
        instanceNumber: l.instanceNumber,
        xMm: l.xMm,
        yMm: l.yMm,
        rotationDeg: l.rotationDeg,
        widthMm: computeOrientedShape(l.outer, l.rotationDeg).width,
        heightMm: computeOrientedShape(l.outer, l.rotationDeg).height,
      })),
      newlyPlacedCountByPart: new Map(),
      stillUnplaced: remainingInstances,
      metrics: {
        algorithm: OPTIMIZER_ALGORITHM_NAME,
        algorithmVersion: OPTIMIZER_ALGORITHM_VERSION,
        strategiesEvaluated: 0,
        localImprovementMoves: 0,
        ruinAndRecreateIterations: 0,
        timeMs: Date.now() - startedAt,
        finalScore: Infinity,
        candidatesEvaluated: rotations.evaluationCount,
        usedBaseline: false,
        rotationStepDeg: opts.rotationStepDeg,
        sheetsUsed: 0,
        utilizationPercent: 0,
        scrapAreaSqm: 0,
        startsEvaluated: 0,
        bestStart: "none",
        totalCandidateLayouts: 0,
      },
    };
  }

  const summary = summarizeSheets([sheet], areaByPartId);

  return {
    placements: sheet.placements,
    newlyPlacedCountByPart,
    stillUnplaced,
    metrics: {
      algorithm: OPTIMIZER_ALGORITHM_NAME,
      algorithmVersion: OPTIMIZER_ALGORITHM_VERSION,
      strategiesEvaluated: 1,
      localImprovementMoves: 0,
      ruinAndRecreateIterations: 0,
      timeMs: Date.now() - startedAt,
      finalScore: scoreLayout([sheet], areaByPartId, buildRepresentativeInstances(outerByPartId, areaByPartId)),
      candidatesEvaluated: rotations.evaluationCount,
      usedBaseline: false,
      rotationStepDeg: opts.rotationStepDeg,
      startsEvaluated: 1,
      bestStart: "seeded-sheet-pack",
      totalCandidateLayouts: 1,
      ...summary,
    },
  };
}

// ----------------------------------------------------------------------------
// Entry point.
// ----------------------------------------------------------------------------
export function optimizeGroupPlacement(
  instances: OptimizerPartInstance[],
  rankedSources: EngineSourceInput[],
  config: EngineConfig,
  options?: OptimizerOptions,
): OptimizeGroupResult {
  const startedAt = Date.now();
  const opts: Required<OptimizerOptions> = { ...DEFAULT_OPTIONS, ...options };
  const deadline = startedAt + opts.timeLimitMs;
  const rotations = new RotationCandidateCache(opts.rotationStepDeg, opts.maxRotationCandidatesPerPart);

  const areaByPartId = new Map<string, number>();
  const outerByPartId = new Map<string, Point[]>();
  for (const inst of instances) {
    areaByPartId.set(inst.takeoffPartId, inst.areaSqm);
    outerByPartId.set(inst.takeoffPartId, inst.outer);
  }
  // Phase 2B — the job's own distinct part shapes double as the
  // "remaining parts" reference set for computeFutureFitScore at every
  // scoring call in this function: while under construction, a candidate
  // layout's leftover space is judged against the same part TYPES this
  // job needs to nest, not a separately-tracked per-step unplaced list.
  const remainingParts = buildRepresentativeInstances(outerByPartId, areaByPartId);

  if (instances.length === 0 || rankedSources.length === 0) {
    const { sheets, placedCountByPart, failureReasonByPart } = constructLayout(
      instances,
      rankedSources,
      config,
      opts.maxCandidatesPerPart,
      rotations,
      opts.packingPreference,
    );
    const emptyMetrics = summarizeSheets(sheets, areaByPartId);
    return {
      sheets: toOptimizedSheets(sheets),
      placedCountByPart,
      failureReasonByPart,
      metrics: {
        algorithm: OPTIMIZER_ALGORITHM_NAME,
        algorithmVersion: OPTIMIZER_ALGORITHM_VERSION,
        strategiesEvaluated: 0,
        localImprovementMoves: 0,
        ruinAndRecreateIterations: 0,
        timeMs: Date.now() - startedAt,
        finalScore: scoreLayout(sheets, areaByPartId, remainingParts),
        candidatesEvaluated: rotations.evaluationCount,
        usedBaseline: false,
        rotationStepDeg: opts.rotationStepDeg,
        startsEvaluated: 0,
        bestStart: "none",
        totalCandidateLayouts: 0,
        ...emptyMetrics,
      },
    };
  }

  // Phase 2 — MULTI-START + TIME-BUDGETED GLOBAL SEARCH.
  //
  // The 8 fixed strategies plus a bounded number of extra seeded/perturbed
  // starts are all genuinely different complete part orderings. Each is
  // constructed into a full layout and scored with the same GLOBAL
  // scoreLayout() objective (never the local placement heuristic), and
  // compared with isBetterLayout() so a layout that places MORE required
  // instances always wins regardless of raw score (spec item 5).
  const baseStrategies = buildStrategies(instances, opts.randomSeed);
  const extraStrategies = buildExtraStartStrategies(instances, baseStrategies, opts.randomSeed, opts.maxExtraRandomStarts);
  const strategies = [...baseStrategies, ...extraStrategies];

  // Reserve a portion of the total time budget for construction (multi-start
  // search); the remainder is left for local improvement + ruin/recreate on
  // the winning candidate. Continuously re-checked (Date.now() per start),
  // never a fixed/unbounded loop — a very small timeLimitMs simply means
  // fewer starts run before this deadline is already in the past.
  const constructionDeadline = Math.min(deadline, startedAt + Math.max(1, Math.floor(opts.timeLimitMs * CONSTRUCTION_BUDGET_FRACTION)));

  let best: ConstructResult | null = null;
  let bestQuality: LayoutQuality | null = null;
  let bestStartName = strategies[0]?.name ?? "none";
  let strategiesEvaluated = 0;

  for (let i = 0; i < strategies.length; i++) {
    if (Date.now() > constructionDeadline) break;
    const strat = strategies[i];
    const result = constructLayout(strat.order, rankedSources, config, opts.maxCandidatesPerPart, rotations, opts.packingPreference);
    strategiesEvaluated++;
    const quality: LayoutQuality = {
      placedTotal: totalPlaced(result.sheets),
      score: scoreLayout(result.sheets, areaByPartId, remainingParts),
    };
    if (isBetterLayout(quality, bestQuality)) {
      bestQuality = quality;
      best = result;
      bestStartName = strat.name;
    }
  }
  if (!best) {
    // Deadline was already exhausted before even the first start — fall
    // back to a single guaranteed construction so a valid result is always
    // returned (spec item 3 / TEST D: very small timeLimitMs must still
    // terminate safely).
    best = constructLayout(strategies[0].order, rankedSources, config, opts.maxCandidatesPerPart, rotations, opts.packingPreference);
    bestQuality = { placedTotal: totalPlaced(best.sheets), score: scoreLayout(best.sheets, areaByPartId, remainingParts) };
    bestStartName = strategies[0].name;
    strategiesEvaluated++;
  }

  const rng = mulberry32(opts.randomSeed + 1000);

  const improved = localImprovement(best.sheets, areaByPartId, outerByPartId, config, opts.maxCandidatesPerPart, deadline, rng, rotations, opts.packingPreference);

  const ruinBudget = Math.max(0, opts.maxIterations - strategiesEvaluated);
  const ruinSearchStartedAt = Date.now();
  const recreated = adaptiveRuinAndRecreate(
    improved.sheets,
    areaByPartId,
    outerByPartId,
    config,
    opts.maxCandidatesPerPart,
    ruinBudget,
    opts.maxSolutions,
    deadline,
    ruinSearchStartedAt,
    rng,
    rotations,
    opts.packingPreference,
  );

  let finalSheets = recreated.sheets;
  if (!revalidate(finalSheets, config.partGapMm)) {
    finalSheets = revalidate(improved.sheets, config.partGapMm) ? improved.sheets : best.sheets;
  }

  const finalScore = scoreLayout(finalSheets, areaByPartId, remainingParts);
  const finalSummary = summarizeSheets(finalSheets, areaByPartId);

  return {
    sheets: toOptimizedSheets(finalSheets),
    placedCountByPart: best.placedCountByPart,
    failureReasonByPart: best.failureReasonByPart,
    metrics: {
      algorithm: OPTIMIZER_ALGORITHM_NAME,
      algorithmVersion: OPTIMIZER_ALGORITHM_VERSION,
      strategiesEvaluated,
      localImprovementMoves: improved.moves,
      ruinAndRecreateIterations: recreated.iterations,
      timeMs: Date.now() - startedAt,
      finalScore,
      candidatesEvaluated: rotations.evaluationCount,
      usedBaseline: false,
      rotationStepDeg: opts.rotationStepDeg,
      startsEvaluated: strategiesEvaluated,
      bestStart: bestStartName,
      totalCandidateLayouts: strategiesEvaluated + improved.trialsEvaluated + recreated.iterations,
      solutionPoolSize: recreated.poolSize,
      ruinOperatorStats: recreated.operatorStats,
      ruinAndRecreateAccepted: recreated.accepted,
      ruinAndRecreateImprovements: recreated.improvements,
      ...finalSummary,
    },
  };
}

function toOptimizedSheets(sheets: WorkingSheet[]): OptimizedSheet[] {
  return sheets
    .filter((s) => s.placements.length > 0)
    .map((s) => ({
      sourceSheetId: s.sourceSheetId,
      material: s.material,
      thicknessMm: s.thicknessMm,
      widthMm: s.widthMm,
      lengthMm: s.lengthMm,
      placements: s.placements,
    }));
}