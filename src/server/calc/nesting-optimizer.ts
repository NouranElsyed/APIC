// Phase 3 — the real optimization layer on top of the geometry primitives
// in nesting-geometry.ts.
//
// This module intentionally depends ONLY on nesting-geometry.ts (pure
// polygon math) plus *type-only* imports from nesting-engine.ts. It never
// imports any value/function from nesting-engine.ts, so there is no runtime
// circular dependency even though nesting-engine.ts imports and calls
// optimizeGroupPlacement() from here.
//
// What changed vs. the old shelf/bottom-left packer (nesting-engine.ts's
// SheetPacker):
//   - Candidate placement positions are no longer "next cursor in the
//     current shelf row". They are derived from the ACTUAL vertices and
//     bounding boxes of every polygon already placed on the sheet (plus
//     the sheet's own corner), so a part can be tucked into a cavity beside
//     a sloped edge instead of being forced into a new horizontal row.
//   - Every part/rotation combination is tried against every candidate,
//     and the tightest valid one (lowest Y, then lowest X) is kept — a
//     "true" bottom-left-fill over real geometry rather than over shelves.
//   - Several different instance orderings ("strategies") are tried and
//     scored; the best initial layout is kept.
//   - A bounded local-improvement pass then tries relocating already-placed
//     parts to better candidate positions.
//   - A bounded ruin-and-recreate metaheuristic removes a small random
//     batch of placements and greedily reinserts them, keeping the result
//     only if the overall score improves — this is what lets the engine
//     escape a bad greedy arrangement instead of being stuck with it.
//   - Every accepted placement — initial, relocated, or reinserted — is
//     validated with the exact same polygon-vs-polygon overlap test used
//     everywhere else in this codebase (polygonsOverlap). Nothing here
//     ever trusts a bounding-box check as the final word.

import type { Point } from "./dxf";
import {
  type RotationDeg,
  SUPPORTED_ROTATIONS,
  type BoundingBox,
  computeBoundingBox,
  computeOrientedShape,
  translatePoints,
  aabbOverlap,
  polygonsOverlap,
  boundsContain,
} from "./nesting-geometry";
import type { EngineConfig, EngineSourceInput, EnginePlacementResult, UnplacedReason } from "./nesting-engine";

export const OPTIMIZER_ALGORITHM_NAME = "candidate-search-multi-strategy-local-improvement";
export const OPTIMIZER_ALGORITHM_VERSION = "1.0.0";

// ----------------------------------------------------------------------------
// Public input/output shapes
// ----------------------------------------------------------------------------

// A part instance to place. Deliberately a plain, minimal shape (not the
// engine's internal PartInstance) so this file has zero value-level
// dependency on nesting-engine.ts.
export interface OptimizerPartInstance {
  takeoffPartId: string;
  itemNo: number;
  instanceNumber: number;
  areaSqm: number;
  outer: Point[];
}

export interface OptimizerOptions {
  maxIterations?: number; // bounds the ruin-and-recreate loop
  maxCandidatesPerPart?: number; // bounds candidate positions tried per part/rotation
  maxSolutions?: number; // how many initial strategies to keep before local improvement
  timeLimitMs?: number; // wall-clock budget for the whole optimize call
  randomSeed?: number; // deterministic seed for strategies + ruin-and-recreate
}

const DEFAULT_OPTIONS: Required<OptimizerOptions> = {
  maxIterations: 300,
  maxCandidatesPerPart: 60,
  maxSolutions: 4,
  timeLimitMs: 6000,
  randomSeed: 20260825,
};

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
}

// ----------------------------------------------------------------------------
// Scoring — sheet count dominates everything else (spec §1/§8): a 1-sheet
// layout must always beat a 2-sheet layout regardless of utilization.
// These weights are intentionally exported/configurable rather than magic
// numbers buried in the formula.
// ----------------------------------------------------------------------------
export const SCORE_WEIGHTS = {
  sheetCountPenalty: 1_000_000, // per additional sheet
  scrapAreaWeight: 1_000, // per m^2 of scrap
  cavityAreaWeight: 50, // per m^2 of (rotated-bbox area - true part area), a proxy for "leaves an unusable pocket around itself"
  utilizationBonusWeight: 10, // per 1% overall utilization
};

// ----------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — every strategy ordering, tie-break
// shuffle, and ruin-and-recreate removal draws from this so the same
// inputs + same randomSeed always produce the same optimized layout
// (matches the rest of the engine's determinism guarantee).
// ----------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------------------
// Internal working sheet representation. Mirrors EngineSourceInput's
// identity fields plus a live list of accepted placements/polygons.
// ----------------------------------------------------------------------------
interface WorkingSheet {
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
  polygons: Point[][]; // parallel to placements
}

function makeWorkingSheet(source: EngineSourceInput, config: EngineConfig): WorkingSheet {
  return {
    sourceSheetId: source.sourceSheetId,
    material: source.material,
    thicknessMm: source.thicknessMm,
    widthMm: source.widthMm,
    lengthMm: source.lengthMm,
    minX: config.marginLeftMm,
    minY: config.marginBottomMm,
    maxX: source.widthMm - config.marginRightMm,
    maxY: source.lengthMm - config.marginTopMm,
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

function couldEverFit(instance: OptimizerPartInstance, source: EngineSourceInput, config: EngineConfig): boolean {
  const w = Math.max(0, source.widthMm - config.marginLeftMm - config.marginRightMm);
  const h = Math.max(0, source.lengthMm - config.marginTopMm - config.marginBottomMm);
  for (const rotation of SUPPORTED_ROTATIONS) {
    const shape = computeOrientedShape(instance.outer, rotation);
    if (shape.width <= w + 1e-6 && shape.height <= h + 1e-6) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Candidate generation — the heart of what makes this different from a
// shelf packer. Anchors come from the sheet's own corner plus every vertex
// and bounding-box corner of every polygon already on the sheet, offset so
// the new shape's bounding box would sit flush against that feature (spec
// §3/§4: "positions derived from ... translated vertices against existing
// polygon edges ... contact points against already placed geometry").
// ----------------------------------------------------------------------------
function generateCandidateOrigins(
  shapeWidth: number,
  shapeHeight: number,
  sheet: WorkingSheet,
  gap: number,
  cap: number,
): Point[] {
  const raw: Point[] = [{ x: sheet.minX, y: sheet.minY }];

  for (const poly of sheet.polygons) {
    const bbox = computeBoundingBox(poly);
    // Contact positions against every real vertex — this is what lets a
    // part tuck in beside a sloped/irregular edge instead of only ever
    // stacking in rows.
    for (const v of poly) {
      raw.push({ x: v.x + gap, y: v.y });
      raw.push({ x: v.x, y: v.y + gap });
      raw.push({ x: v.x - shapeWidth - gap, y: v.y });
      raw.push({ x: v.x, y: v.y - shapeHeight - gap });
    }
    // Horizontal/vertical edge (bounding-box) alignments — the classic
    // "shelf corner" positions, but now generated per already-placed part
    // rather than per row, so they compose with the cavity positions above.
    raw.push({ x: bbox.maxX + gap, y: bbox.minY });
    raw.push({ x: bbox.minX, y: bbox.maxY + gap });
    raw.push({ x: bbox.maxX + gap, y: bbox.maxY - shapeHeight });
    raw.push({ x: bbox.maxX - shapeWidth, y: bbox.maxY + gap });
  }

  // Keep only geometrically plausible candidates (loose AABB pre-filter —
  // exact validation happens per-candidate by the caller) and dedupe.
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
  return filtered.slice(0, cap);
}

interface PlacementAttempt {
  x: number;
  y: number;
  rotationDeg: RotationDeg;
  width: number;
  height: number;
  polygon: Point[];
}

// Tries every rotation x every candidate origin for `instance` against
// `sheet`, returning the tightest valid placement found (lowest Y, then
// lowest X, across ALL rotations — not just the first rotation that fits,
// unlike the old shelf packer). Every candidate is validated with the
// exact same boundary + AABB + polygon overlap checks used elsewhere.
function findBestPlacement(
  instance: OptimizerPartInstance,
  sheet: WorkingSheet,
  config: EngineConfig,
  maxCandidates: number,
): PlacementAttempt | null {
  if (usableWidth(sheet) <= 0 || usableHeight(sheet) <= 0) return null;

  let best: PlacementAttempt | null = null;

  for (const rotation of SUPPORTED_ROTATIONS) {
    const shape = computeOrientedShape(instance.outer, rotation);
    if (shape.width > usableWidth(sheet) + 1e-6 || shape.height > usableHeight(sheet) + 1e-6) continue;

    const candidates = generateCandidateOrigins(shape.width, shape.height, sheet, config.partGapMm, maxCandidates);

    for (const c of candidates) {
      // Already worse than the best found for another rotation — every
      // later candidate for THIS rotation is sorted so it can only get
      // worse too, so we can stop scanning this rotation's list early.
      if (best && (c.y > best.y + 1e-9 || (Math.abs(c.y - best.y) < 1e-9 && c.x >= best.x))) break;

      const polygon = translatePoints(shape.points, c.x, c.y);

      if (!boundsContain(polygon, sheet.minX, sheet.minY, sheet.maxX, sheet.maxY)) continue;

      const candidateBBox: BoundingBox = {
        minX: c.x,
        minY: c.y,
        maxX: c.x + shape.width,
        maxY: c.y + shape.height,
        width: shape.width,
        height: shape.height,
      };

      // Broad-phase (spec §"bounding boxes may only be used as broad-phase
      // acceleration, never as the actual nesting geometry"): an AABB
      // overlap is only ever used to decide whether the expensive exact
      // polygon check is needed against THAT specific existing placement —
      // never to reject the candidate outright. Two concave/complementary
      // shapes (e.g. two triangles that together tile a rectangle) very
      // commonly have overlapping bounding boxes while their actual
      // polygons don't overlap at all; rejecting on bbox overlap alone
      // would make that kind of cavity/interlock placement impossible.
      let polygonCollision = false;
      for (let i = 0; i < sheet.placements.length; i++) {
        const p = sheet.placements[i];
        const existingBBox: BoundingBox = {
          minX: p.xMm,
          minY: p.yMm,
          maxX: p.xMm + p.widthMm,
          maxY: p.yMm + p.heightMm,
          width: p.widthMm,
          height: p.heightMm,
        };
        if (!aabbOverlap(candidateBBox, existingBBox)) continue; // definitely no overlap — skip the exact check
        if (polygonsOverlap(polygon, sheet.polygons[i])) {
          polygonCollision = true;
          break;
        }
      }
      if (polygonCollision) continue;

      best = { x: c.x, y: c.y, rotationDeg: rotation, width: shape.width, height: shape.height, polygon };
    }
  }

  return best;
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

// ----------------------------------------------------------------------------
// Layout construction — places every instance (in the given order) into
// already-open sheets first, opening new ones (best-fit source first,
// respecting hard availableQty caps) only when nothing open can take it.
// Mirrors the open/fresh-sheet logic in nesting-engine.ts's packInstances,
// but placement itself goes through findBestPlacement instead of a shelf
// cursor.
// ----------------------------------------------------------------------------
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
      const attempt = findBestPlacement(instance, sheet, config, maxCandidates);
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
        const attempt = findBestPlacement(instance, sheet, config, maxCandidates);
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
    } else if (!rankedSources.some((s) => couldEverFit(instance, s, config))) {
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

// ----------------------------------------------------------------------------
// Scoring a full layout (spec §1/§8): sheet count is a near-infinite
// penalty, so a solution using fewer sheets always wins regardless of
// utilization; scrap area and "cavity" waste (bbox overhead per part) are
// the tie-breakers between same-sheet-count solutions.
// ----------------------------------------------------------------------------
function scoreLayout(sheets: WorkingSheet[], areaByPartId: Map<string, number>): number {
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

  return (
    usedSheets.length * SCORE_WEIGHTS.sheetCountPenalty +
    scrapAreaSqm * SCORE_WEIGHTS.scrapAreaWeight +
    cavityAreaSqm * SCORE_WEIGHTS.cavityAreaWeight -
    utilizationPercent * SCORE_WEIGHTS.utilizationBonusWeight
  );
}

// ----------------------------------------------------------------------------
// Strategies (spec §5) — different deterministic orderings of the same
// instance list. Each produces an independent initial layout via
// constructLayout(); the best-scoring one seeds local improvement.
// ----------------------------------------------------------------------------
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
  // How much bigger the bounding box is than the true (DXF) area — a
  // simple, generalizable proxy for "hard to pack" concave/irregular
  // shapes (spec §5E), with no per-shape special-casing.
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
    {
      name: "largest-area-first",
      order: [...instances].sort((a, b) => b.areaSqm - a.areaSqm || stableTieBreak(a, b)),
    },
    {
      name: "longest-edge-first",
      order: [...instances].sort((a, b) => edgeLengthMax(b.outer) - edgeLengthMax(a.outer) || stableTieBreak(a, b)),
    },
    {
      name: "largest-bounding-box-first",
      order: [...instances].sort((a, b) => bboxArea(b.outer) - bboxArea(a.outer) || stableTieBreak(a, b)),
    },
    {
      name: "most-constrained-first",
      order: [...instances].sort((a, b) => bboxMaxDim(b.outer) - bboxMaxDim(a.outer) || stableTieBreak(a, b)),
    },
    {
      name: "irregular-shapes-first",
      order: [...instances].sort((a, b) => irregularity(b) - irregularity(a) || stableTieBreak(a, b)),
    },
    {
      name: "rotated-first-variant",
      // Same ranking idea as bbox-first but tie-broken on the SHORT side,
      // which tends to reorder near-square vs. elongated parts differently
      // and so explores a genuinely different construction order rather
      // than duplicating "largest-bounding-box-first".
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

// ----------------------------------------------------------------------------
// Local improvement (spec §6) — for each placed instance, try removing it
// and re-placing it (any rotation, any candidate) either on its current
// sheet or an earlier sheet; keep the move only if it improves the score.
// Bounded by remaining iteration/time budget.
// ----------------------------------------------------------------------------
function localImprovement(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  deadline: number,
  rng: () => number,
): { sheets: WorkingSheet[]; moves: number } {
  let working = cloneLayout(sheets);
  let bestScore = scoreLayout(working, areaByPartId);
  let moves = 0;

  // Flat list of (sheetIndex, placementIndex) pairs, shuffled so the
  // improvement order isn't biased by construction order.
  let targets: { sheetIdx: number; placementIdx: number }[] = [];
  working.forEach((sheet, sheetIdx) => {
    sheet.placements.forEach((_, placementIdx) => targets.push({ sheetIdx, placementIdx }));
  });
  targets = seededShuffle(targets, rng);

  for (const t of targets) {
    if (Date.now() > deadline) break;

    const trial = cloneLayout(working);
    const originSheet = trial[t.sheetIdx];
    const removedPlacement = originSheet.placements[t.placementIdx];
    const removedPolygon = originSheet.polygons[t.placementIdx];
    if (!removedPlacement || !removedPolygon) continue;

    originSheet.placements.splice(t.placementIdx, 1);
    originSheet.polygons.splice(t.placementIdx, 1);

    // IMPORTANT: rotation search must always start from the part's
    // ORIGINAL, untransformed contour — never from the already-placed
    // (already-rotated) sheet-space polygon. `attempt.rotationDeg` below
    // is stored verbatim as the placement's final, ABSOLUTE rotation
    // (see EnginePlacementResult / DXF export), so if we searched
    // rotations of an already-rotated shape, a second relocation could
    // silently compose rotations (e.g. "rotate the 90°-placed part by a
    // further 180°") while only ever recording the second, partial
    // rotation — producing a stored rotationDeg that does not match the
    // real geometry. Re-deriving from the original outer keeps every
    // rotationDeg absolute and correct.
    const originalOuter = outerByPartId.get(removedPlacement.takeoffPartId) ?? removedPolygon;
    const asInstance: OptimizerPartInstance = {
      takeoffPartId: removedPlacement.takeoffPartId,
      itemNo: 0,
      instanceNumber: removedPlacement.instanceNumber,
      areaSqm: areaByPartId.get(removedPlacement.takeoffPartId) ?? 0,
      outer: originalOuter,
    };

    // Try every sheet, keep the tightest (lowest Y, then X) valid spot —
    // same tie-break convention as construction, so this is a genuine
    // "can this part sit somewhere better" search, not a single guess.
    let relocated: { sheetIdx: number; attempt: PlacementAttempt } | null = null;
    trial.forEach((candidateSheet, sIdx) => {
      const attempt = findBestPlacement(asInstance, candidateSheet, config, maxCandidates);
      if (!attempt) return;
      if (!relocated || attempt.y < relocated.attempt.y - 1e-9 || (Math.abs(attempt.y - relocated.attempt.y) < 1e-9 && attempt.x < relocated.attempt.x)) {
        relocated = { sheetIdx: sIdx, attempt };
      }
    });

    if (!relocated) {
      // No valid relocation found at all — put it back exactly where it was.
      originSheet.placements.splice(t.placementIdx, 0, removedPlacement);
      originSheet.polygons.splice(t.placementIdx, 0, removedPolygon);
      continue;
    }

    const r: { sheetIdx: number; attempt: PlacementAttempt } = relocated;
    commitPlacement(trial[r.sheetIdx], asInstance, r.attempt);

    const trialScore = scoreLayout(trial, areaByPartId);
    if (trialScore < bestScore - 1e-6) {
      working = trial;
      bestScore = trialScore;
      moves++;
    }
    // else: discard trial, `working` is unaffected (it was cloned before mutation).
  }

  return { sheets: working, moves };
}

// ----------------------------------------------------------------------------
// Ruin-and-recreate (spec §7) — the bounded metaheuristic that lets the
// engine escape a local optimum: remove a small random batch of
// placements, then greedily reinsert them (largest first) using the same
// candidate search. Keep the result only if it scores at least as well as
// before the ruin; otherwise revert. Simple, deterministic (seeded), and
// bounded by maxIterations/timeLimitMs — no unbounded search.
// ----------------------------------------------------------------------------
function ruinAndRecreate(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  maxIterations: number,
  deadline: number,
  rng: () => number,
): { sheets: WorkingSheet[]; iterations: number } {
  let working = cloneLayout(sheets);
  let bestScore = scoreLayout(working, areaByPartId);
  let iterations = 0;

  const totalPlacements = working.reduce((sum, s) => sum + s.placements.length, 0);
  if (totalPlacements < 2) return { sheets: working, iterations: 0 };

  for (let iter = 0; iter < maxIterations; iter++) {
    if (Date.now() > deadline) break;
    iterations++;

    const trial = cloneLayout(working);
    const ruinSize = Math.max(1, Math.min(4, Math.floor(totalPlacements * 0.08) + 1));

    // Pick ruinSize random placements across all sheets and pull them out,
    // capturing their outer polygons (at removal time) so they can be
    // reinserted with the same rotation via a shifted translate.
    const flat: { sheetIdx: number; placementIdx: number }[] = [];
    trial.forEach((s, sIdx) => s.placements.forEach((_, pIdx) => flat.push({ sheetIdx: sIdx, placementIdx: pIdx })));
    const toRemove = seededShuffle(flat, rng).slice(0, Math.min(ruinSize, flat.length));
    // Remove from highest index first per sheet so splicing doesn't shift
    // indices out from under later removals in the same sheet.
    toRemove.sort((a, b) => (a.sheetIdx !== b.sheetIdx ? b.sheetIdx - a.sheetIdx : b.placementIdx - a.placementIdx));

    const removed: { instance: OptimizerPartInstance; polygon: Point[] }[] = [];
    for (const r of toRemove) {
      const sheet = trial[r.sheetIdx];
      const [placement] = sheet.placements.splice(r.placementIdx, 1);
      const [polygon] = sheet.polygons.splice(r.placementIdx, 1);
      if (!placement || !polygon) continue;
      // As in localImprovement: rotation search must restart from the
      // ORIGINAL outer contour so the reinserted placement's rotationDeg
      // stays absolute/correct rather than composing with whatever
      // rotation it already had (see comment in localImprovement).
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

    // Greedy reinsert, largest-removed-part first (by original bbox area).
    removed.sort((a, b) => bboxArea(b.instance.outer) - bboxArea(a.instance.outer));

    let allReinserted = true;
    for (const r of removed) {
      let placedSomewhere = false;
      for (const sheet of trial) {
        const attempt = findBestPlacement(r.instance, sheet, config, maxCandidates);
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

    if (!allReinserted) continue; // revert: `working` untouched, trial discarded

    const trialScore = scoreLayout(trial, areaByPartId);
    if (trialScore <= bestScore + 1e-6) {
      working = trial;
      bestScore = trialScore;
    }
    // else revert (trial discarded, working stays as-is)
  }

  return { sheets: working, iterations };
}

// ----------------------------------------------------------------------------
// Final revalidation (spec §11) — never trust intermediate optimizer
// state. Re-checks every placement's polygon against every other polygon
// on its sheet and against sheet bounds from scratch before returning.
// ----------------------------------------------------------------------------
function revalidate(sheets: WorkingSheet[]): boolean {
  for (const sheet of sheets) {
    for (let i = 0; i < sheet.polygons.length; i++) {
      if (!boundsContain(sheet.polygons[i], sheet.minX, sheet.minY, sheet.maxX, sheet.maxY)) return false;
      for (let j = i + 1; j < sheet.polygons.length; j++) {
        if (polygonsOverlap(sheet.polygons[i], sheet.polygons[j])) return false;
      }
    }
  }
  return true;
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

  const areaByPartId = new Map<string, number>();
  const outerByPartId = new Map<string, Point[]>();
  for (const inst of instances) {
    areaByPartId.set(inst.takeoffPartId, inst.areaSqm);
    outerByPartId.set(inst.takeoffPartId, inst.outer);
  }

  if (instances.length === 0 || rankedSources.length === 0) {
    const { sheets, placedCountByPart, failureReasonByPart } = constructLayout(instances, rankedSources, config, opts.maxCandidatesPerPart);
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
        finalScore: scoreLayout(sheets, areaByPartId),
      },
    };
  }

  const strategies = buildStrategies(instances, opts.randomSeed);

  // Evaluate every strategy's initial construction, keep the best.
  let best: ConstructResult | null = null;
  let bestScore = Infinity;
  let strategiesEvaluated = 0;
  for (const strat of strategies) {
    if (Date.now() > deadline) break;
    const result = constructLayout(strat.order, rankedSources, config, opts.maxCandidatesPerPart);
    strategiesEvaluated++;
    const score = scoreLayout(result.sheets, areaByPartId);
    if (score < bestScore) {
      bestScore = score;
      best = result;
    }
  }
  // Should not happen (strategies list is non-empty and instances/sources
  // are non-empty here), but never return a null layout.
  if (!best) {
    best = constructLayout(strategies[0].order, rankedSources, config, opts.maxCandidatesPerPart);
  }

  const rng = mulberry32(opts.randomSeed + 1000);

  const improved = localImprovement(best.sheets, areaByPartId, outerByPartId, config, opts.maxCandidatesPerPart, deadline, rng);

  const ruinBudget = Math.max(0, opts.maxIterations - strategiesEvaluated);
  const recreated = ruinAndRecreate(improved.sheets, areaByPartId, outerByPartId, config, opts.maxCandidatesPerPart, ruinBudget, deadline, rng);

  let finalSheets = recreated.sheets;
  if (!revalidate(finalSheets)) {
    // Defensive fallback (spec §11: never trust intermediate state) — if
    // anything downstream of construction somehow produced an invalid
    // layout, fall back to the last known-good state.
    finalSheets = revalidate(improved.sheets) ? improved.sheets : best.sheets;
  }

  const finalScore = scoreLayout(finalSheets, areaByPartId);

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
