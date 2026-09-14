// Phase 3 — the real optimization layer on top of the geometry primitives
// in nesting-geometry.ts.

import type { Point } from "./dxf";
import {
  type RotationDeg,
  generateRotationCandidates,
  type BoundingBox,
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
export const OPTIMIZER_ALGORITHM_VERSION = "1.0.0";

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
}

const DEFAULT_OPTIONS: Required<OptimizerOptions> = {
  maxIterations: 300,
  maxCandidatesPerPart: 60,
  maxSolutions: 4,
  timeLimitMs: 6000,
  randomSeed: 20260825,
  rotationStepDeg: 5,
  maxRotationCandidatesPerPart: 48,
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
  candidatesEvaluated: number;
  usedBaseline: boolean;
  rotationStepDeg: number;
  sheetsUsed: number;
  utilizationPercent: number;
  scrapAreaSqm: number;
}

export const SCORE_WEIGHTS = {
  sheetCountPenalty: 1_000_000,
  scrapAreaWeight: 1_000,
  cavityAreaWeight: 50,
  utilizationBonusWeight: 10,
};

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
  polygons: Point[][];
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

class RotationCandidateCache {
  private readonly cache = new Map<string, RotationDeg[]>();
  private evaluations = 0;

  constructor(
    private readonly rotationStepDeg: number,
    private readonly maxCandidates: number,
  ) {}

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

function findBestPlacement(
  instance: OptimizerPartInstance,
  sheet: WorkingSheet,
  config: EngineConfig,
  maxCandidates: number,
  rotations: RotationCandidateCache,
): PlacementAttempt | null {
  if (usableWidth(sheet) <= 0 || usableHeight(sheet) <= 0) return null;

  let best: PlacementAttempt | null = null;

  for (const rotation of rotations.get(instance)) {
    const shape = computeOrientedShape(instance.outer, rotation);
    if (shape.width > usableWidth(sheet) + 1e-6 || shape.height > usableHeight(sheet) + 1e-6) continue;

    const candidates = generateCandidateOrigins(shape.width, shape.height, sheet, config.partGapMm, maxCandidates);

    for (const c of candidates) {
      if (best && (c.y > best.y + 1e-9 || (Math.abs(c.y - best.y) < 1e-9 && c.x >= best.x))) break;

      rotations.recordEvaluation();
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
        // BUGFIX: the required gap was previously never actually
        // verified here — `gap` was only ever used as an offset when
        // GENERATING candidate origins near existing vertices, so a
        // candidate reached via a different code path (e.g. the sheet's
        // own corner, or a vertex-relative candidate for a DIFFERENT
        // neighbor) could land closer than `partGapMm` to this part with
        // nothing rejecting it. Exact (non-bbox) distance, so a
        // non-rectangular outline's real clearance is measured, not its
        // bounding box's.
        if (config.partGapMm > 0 && polygonsMinDistance(polygon, sheet.polygons[i]) < config.partGapMm - 1e-6) {
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
      const attempt = findBestPlacement(instance, sheet, config, maxCandidates, rotations);
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
        const attempt = findBestPlacement(instance, sheet, config, maxCandidates, rotations);
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

export function scoreSheets(
  sheets: { widthMm: number; lengthMm: number; placements: EnginePlacementResult[] }[],
  areaByPartId: Map<string, number>,
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

  return (
    usedSheets.length * SCORE_WEIGHTS.sheetCountPenalty +
    scrapAreaSqm * SCORE_WEIGHTS.scrapAreaWeight +
    cavityAreaSqm * SCORE_WEIGHTS.cavityAreaWeight -
    utilizationPercent * SCORE_WEIGHTS.utilizationBonusWeight
  );
}

function scoreLayout(sheets: WorkingSheet[], areaByPartId: Map<string, number>): number {
  return scoreSheets(sheets, areaByPartId);
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

function localImprovement(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  deadline: number,
  rng: () => number,
  rotations: RotationCandidateCache,
): { sheets: WorkingSheet[]; moves: number } {
  let working = cloneLayout(sheets);
  let bestScore = scoreLayout(working, areaByPartId);
  let moves = 0;

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

    const originalOuter = outerByPartId.get(removedPlacement.takeoffPartId) ?? removedPolygon;
    const asInstance: OptimizerPartInstance = {
      takeoffPartId: removedPlacement.takeoffPartId,
      itemNo: 0,
      instanceNumber: removedPlacement.instanceNumber,
      areaSqm: areaByPartId.get(removedPlacement.takeoffPartId) ?? 0,
      outer: originalOuter,
    };

    let relocated: { sheetIdx: number; attempt: PlacementAttempt } | null = null;
    trial.forEach((candidateSheet, sIdx) => {
      const attempt = findBestPlacement(asInstance, candidateSheet, config, maxCandidates, rotations);
      if (!attempt) return;
      if (!relocated || attempt.y < relocated.attempt.y - 1e-9 || (Math.abs(attempt.y - relocated.attempt.y) < 1e-9 && attempt.x < relocated.attempt.x)) {
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

    const trialScore = scoreLayout(trial, areaByPartId);
    if (trialScore < bestScore - 1e-6) {
      working = trial;
      bestScore = trialScore;
      moves++;
    }
  }

  return { sheets: working, moves };
}

function ruinAndRecreate(
  sheets: WorkingSheet[],
  areaByPartId: Map<string, number>,
  outerByPartId: Map<string, Point[]>,
  config: EngineConfig,
  maxCandidates: number,
  maxIterations: number,
  deadline: number,
  rng: () => number,
  rotations: RotationCandidateCache,
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

    const flat: { sheetIdx: number; placementIdx: number }[] = [];
    trial.forEach((s, sIdx) => s.placements.forEach((_, pIdx) => flat.push({ sheetIdx: sIdx, placementIdx: pIdx })));
    const toRemove = seededShuffle(flat, rng).slice(0, Math.min(ruinSize, flat.length));
    toRemove.sort((a, b) => (a.sheetIdx !== b.sheetIdx ? b.sheetIdx - a.sheetIdx : b.placementIdx - a.placementIdx));

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

    removed.sort((a, b) => bboxArea(b.instance.outer) - bboxArea(a.instance.outer));

    let allReinserted = true;
    for (const r of removed) {
      let placedSomewhere = false;
      for (const sheet of trial) {
        const attempt = findBestPlacement(r.instance, sheet, config, maxCandidates, rotations);
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

    const trialScore = scoreLayout(trial, areaByPartId);
    if (trialScore <= bestScore + 1e-6) {
      working = trial;
      bestScore = trialScore;
    }
  }

  return { sheets: working, iterations };
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
    const attempt = findBestPlacement(instance, sheet, config, opts.maxCandidatesPerPart, rotations);
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
      finalScore: scoreLayout([sheet], areaByPartId),
      candidatesEvaluated: rotations.evaluationCount,
      usedBaseline: false,
      rotationStepDeg: opts.rotationStepDeg,
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

  if (instances.length === 0 || rankedSources.length === 0) {
    const { sheets, placedCountByPart, failureReasonByPart } = constructLayout(
      instances,
      rankedSources,
      config,
      opts.maxCandidatesPerPart,
      rotations,
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
        finalScore: scoreLayout(sheets, areaByPartId),
        candidatesEvaluated: rotations.evaluationCount,
        usedBaseline: false,
        rotationStepDeg: opts.rotationStepDeg,
        ...emptyMetrics,
      },
    };
  }

  const strategies = buildStrategies(instances, opts.randomSeed);

  let best: ConstructResult | null = null;
  let bestScore = Infinity;
  let strategiesEvaluated = 0;
  for (const strat of strategies) {
    if (Date.now() > deadline) break;
    const result = constructLayout(strat.order, rankedSources, config, opts.maxCandidatesPerPart, rotations);
    strategiesEvaluated++;
    const score = scoreLayout(result.sheets, areaByPartId);
    if (score < bestScore) {
      bestScore = score;
      best = result;
    }
  }
  if (!best) {
    best = constructLayout(strategies[0].order, rankedSources, config, opts.maxCandidatesPerPart, rotations);
  }

  const rng = mulberry32(opts.randomSeed + 1000);

  const improved = localImprovement(best.sheets, areaByPartId, outerByPartId, config, opts.maxCandidatesPerPart, deadline, rng, rotations);

  const ruinBudget = Math.max(0, opts.maxIterations - strategiesEvaluated);
  const recreated = ruinAndRecreate(improved.sheets, areaByPartId, outerByPartId, config, opts.maxCandidatesPerPart, ruinBudget, deadline, rng, rotations);

  let finalSheets = recreated.sheets;
  if (!revalidate(finalSheets, config.partGapMm)) {
    finalSheets = revalidate(improved.sheets, config.partGapMm) ? improved.sheets : best.sheets;
  }

  const finalScore = scoreLayout(finalSheets, areaByPartId);
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
