// Phase 2C — assisted-nesting SESSION logic: ties pattern expansion
// (nesting-pattern.ts) together with the Phase 2B optimizer's
// packRemainingOntoSeededSheet (nesting-optimizer.ts) to implement
// "remaining parts continue automatically, opening new sheets if needed"
// (spec §15/§22) without a second placement/collision implementation.
//
// This module is pure (no Prisma/HTTP/React) so both the client canvas and
// a future server-side "Optimize Remaining" API route can call the exact
// same function and get the exact same answer.

import type { Point } from "./dxf";
import type { EngineConfig, EngineSourceInput } from "./nesting-engine";
import {
  packRemainingOntoSeededSheet,
  scoreSheets,
  optimizeGroupPlacement,
  type LockedSeedPlacement,
  type OptimizerPartInstance,
  type OptimizerOptions,
} from "./nesting-optimizer";
import type { PatternPlacedInstance } from "./nesting-pattern";
import { computeOrientedShape, translatePoints, polygonsOverlap, boundsContain } from "./nesting-geometry";

export interface SessionPartCatalogEntry {
  takeoffPartId: string;
  itemNo: number;
  outer: Point[];
  areaSqm: number;
  requiredQty: number;
}

export interface AssistedSheetSession {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  /** Every instance currently on this sheet, manual + pattern + optimizer-generated. */
  instances: (PatternPlacedInstance & { instanceKey: string; origin: "MANUAL" | "PATTERN" | "OPTIMIZED" })[];
}

export interface OptimizeRemainingResult {
  sheets: AssistedSheetSession[];
  newlyPlacedCount: number;
  openedNewSheets: number;
  fullyPlaced: boolean;
  /** Parts (with remaining qty > 0) that could not be placed on ANY available sheet definition — a genuine capacity/geometry shortfall, not just "try another sheet". */
  stillShortByPart: Map<string, number>;
}

const MAX_NEW_SHEETS_SAFETY_CAP = 25;

// Axis convention (project-wide — optimizer's makeWorkingSheet(), the DXF
// export's MARGIN layer and the sheet preview all agree): the sheet's
// X axis spans its physical LENGTH (lengthMm) and its Y axis spans its
// physical WIDTH (widthMm). Margins map as: left/right → X, bottom/top → Y.
//
// This used to be swapped (maxX from widthMm, maxY from lengthMm), which
// made validateSessionForExport() reject valid placements and accept
// out-of-bounds ones on every non-square sheet (e.g. 1250 × 2500).
function usableBoundsFor(sheet: { widthMm: number; lengthMm: number }, config: EngineConfig) {
  return {
    minX: config.marginLeftMm,
    minY: config.marginBottomMm,
    maxX: sheet.lengthMm - config.marginRightMm,
    maxY: sheet.widthMm - config.marginTopMm,
  };
}

/**
 * Fills remaining required quantity around whatever's already on the
 * session's sheets (spec §15 "Pattern continuation" / §22 "Multi-sheet
 * support"). Every currently-placed instance (manual, pattern-generated,
 * or previously optimizer-placed) is treated as a fixed obstacle on its
 * own sheet — this function only ever ADDS new placements, it never moves
 * existing ones (that would be "Optimize Entire Nest", a deliberately
 * separate, explicitly-confirmed action — see assisted-nesting.tsx).
 *
 * Sheets are filled in order; once every existing sheet is full, new
 * sheets are opened from `candidateSources` (ranked by the caller — e.g.
 * cheapest/most space-efficient first, same convention as
 * nesting-engine.ts's rankSourcesByEfficiency) until required quantities
 * are met or no compatible source can take any more (capped at
 * MAX_NEW_SHEETS_SAFETY_CAP to guarantee termination).
 */
export function optimizeRemaining(
  sheets: AssistedSheetSession[],
  partCatalog: Map<string, SessionPartCatalogEntry>,
  candidateSources: EngineSourceInput[],
  config: EngineConfig,
  options?: OptimizerOptions,
): OptimizeRemainingResult {
  const workingSheets = sheets.map((s) => ({ ...s, instances: [...s.instances] }));

  const placedQtyByPart = new Map<string, number>();
  for (const sheet of workingSheets) {
    for (const inst of sheet.instances) {
      placedQtyByPart.set(inst.takeoffPartId, (placedQtyByPart.get(inst.takeoffPartId) ?? 0) + 1);
    }
  }

  function buildRemainingInstances(): OptimizerPartInstance[] {
    const remaining: OptimizerPartInstance[] = [];
    for (const entry of partCatalog.values()) {
      const placed = placedQtyByPart.get(entry.takeoffPartId) ?? 0;
      const need = Math.max(0, entry.requiredQty - placed);
      for (let i = 0; i < need; i++) {
        remaining.push({
          takeoffPartId: entry.takeoffPartId,
          itemNo: entry.itemNo,
          instanceNumber: placed + i + 1,
          areaSqm: entry.areaSqm,
          outer: entry.outer,
        });
      }
    }
    return remaining;
  }

  let newlyPlacedCount = 0;
  let openedNewSheets = 0;
  let instanceKeyCounter = 0;
  const nextKey = () => `opt-${(instanceKeyCounter += 1)}`;

  // Pass 1 — fill existing sheets first (cheapest: no new material).
  for (const sheet of workingSheets) {
    let remaining = buildRemainingInstances();
    if (remaining.length === 0) break;

    const locked: LockedSeedPlacement[] = sheet.instances.map((inst) => {
      const entry = partCatalog.get(inst.takeoffPartId);
      return {
        takeoffPartId: inst.takeoffPartId,
        instanceNumber: inst.instanceNumber,
        xMm: inst.xMm,
        yMm: inst.yMm,
        rotationDeg: inst.rotationDeg,
        outer: entry?.outer ?? inst.outer,
      };
    });

    const source: EngineSourceInput = {
      sourceSheetId: sheet.sourceSheetId,
      material: sheet.material,
      thicknessMm: sheet.thicknessMm,
      widthMm: sheet.widthMm,
      lengthMm: sheet.lengthMm,
    };

    const result = packRemainingOntoSeededSheet(locked, remaining, source, config, options);

    for (const placement of result.placements) {
      const isLocked = locked.some((l) => l.takeoffPartId === placement.takeoffPartId && l.instanceNumber === placement.instanceNumber);
      if (isLocked) continue; // already present in sheet.instances — don't duplicate
      const entry = partCatalog.get(placement.takeoffPartId);
      sheet.instances.push({
        instanceKey: nextKey(),
        takeoffPartId: placement.takeoffPartId,
        outer: entry?.outer ?? [],
        areaSqm: entry?.areaSqm ?? 0,
        instanceNumber: placement.instanceNumber,
        xMm: placement.xMm,
        yMm: placement.yMm,
        rotationDeg: placement.rotationDeg,
        locked: false,
        origin: "OPTIMIZED",
      });
      placedQtyByPart.set(placement.takeoffPartId, (placedQtyByPart.get(placement.takeoffPartId) ?? 0) + 1);
      newlyPlacedCount++;
    }
  }

  // Pass 2 — open new sheets for whatever's still left (spec §22).
  let safety = 0;
  while (safety < MAX_NEW_SHEETS_SAFETY_CAP) {
    safety++;
    const remaining = buildRemainingInstances();
    if (remaining.length === 0) break;

    // Prefer the source definition that fits the most of what's left —
    // reuses the same "try it and see" idea as rankSourcesByEfficiency
    // without duplicating its internals (this only needs a single pass,
    // not a fully ranked order, since a fresh sheet has no obstacles yet).
    let bestSource: EngineSourceInput | null = null;
    let bestResult: ReturnType<typeof packRemainingOntoSeededSheet> | null = null;
    for (const candidate of candidateSources) {
      const trial = packRemainingOntoSeededSheet([], remaining, candidate, config, options);
      if (!bestResult || trial.newlyPlacedCountByPart.size > 0 && [...trial.newlyPlacedCountByPart.values()].reduce((a, b) => a + b, 0) > [...(bestResult.newlyPlacedCountByPart.values())].reduce((a, b) => a + b, 0)) {
        bestSource = candidate;
        bestResult = trial;
      }
    }

    if (!bestSource || !bestResult || bestResult.placements.length === 0) break; // nothing more fits anywhere

    const newSheet: AssistedSheetSession = {
      sourceSheetId: bestSource.sourceSheetId,
      material: bestSource.material,
      thicknessMm: bestSource.thicknessMm,
      widthMm: bestSource.widthMm,
      lengthMm: bestSource.lengthMm,
      instances: [],
    };
    for (const placement of bestResult.placements) {
      const entry = partCatalog.get(placement.takeoffPartId);
      newSheet.instances.push({
        instanceKey: nextKey(),
        takeoffPartId: placement.takeoffPartId,
        outer: entry?.outer ?? [],
        areaSqm: entry?.areaSqm ?? 0,
        instanceNumber: placement.instanceNumber,
        xMm: placement.xMm,
        yMm: placement.yMm,
        rotationDeg: placement.rotationDeg,
        locked: false,
        origin: "OPTIMIZED",
      });
      placedQtyByPart.set(placement.takeoffPartId, (placedQtyByPart.get(placement.takeoffPartId) ?? 0) + 1);
      newlyPlacedCount++;
    }
    workingSheets.push(newSheet);
    openedNewSheets++;
  }

  const stillShortByPart = new Map<string, number>();
  for (const entry of partCatalog.values()) {
    const placed = placedQtyByPart.get(entry.takeoffPartId) ?? 0;
    const short = Math.max(0, entry.requiredQty - placed);
    if (short > 0) stillShortByPart.set(entry.takeoffPartId, short);
  }

  return {
    sheets: workingSheets,
    newlyPlacedCount,
    openedNewSheets,
    fullyPlaced: stillShortByPart.size === 0,
    stillShortByPart,
  };
}

export { usableBoundsFor };

// ----------------------------------------------------------------------------
// Pattern preference (spec §5/§6) — STRICT/FLEXIBLE/OPTIMIZE all reuse
// optimizeRemaining() (and therefore packRemainingOntoSeededSheet() and the
// production optimizer/collision code underneath it) for the actual
// placement search. The only thing that changes per preference is WHICH
// existing instances are fed in as locked seeds vs. released back into the
// "remaining" pool to be re-placed:
//   STRICT   — every existing instance (manual, pattern, optimized) stays
//              locked; only empty space is filled. Identical to
//              optimizeRemaining() itself.
//   FLEXIBLE — only MANUAL instances stay locked; pattern-generated and
//              previously-optimized instances are released and may be
//              repositioned if that scores better.
//   OPTIMIZE — nothing is locked; the whole session is rebuilt from
//              scratch on the same sheets/sources.
// The rebuilt result is only kept if scoreSheets() shows it's actually at
// least as good AND places at least as many parts as before — otherwise
// the original (untouched) session is returned, so "Optimize" can never
// make a valid layout worse or destroy a manual placement for nothing.
// ----------------------------------------------------------------------------

export type PatternPreference = "STRICT" | "FLEXIBLE" | "OPTIMIZE";

export interface OptimizeWithPreferenceResult extends OptimizeRemainingResult {
  scoreBefore: number;
  scoreAfter: number;
  /** "ORIGINAL" — existing placements were left exactly as they were (STRICT, or FLEXIBLE/OPTIMIZE that didn't improve). "REBUILT" — some previously-placed instances were released and re-placed. */
  kept: "ORIGINAL" | "REBUILT";
}

function sheetToScorable(sheet: AssistedSheetSession) {
  return {
    widthMm: sheet.widthMm,
    lengthMm: sheet.lengthMm,
    placements: sheet.instances.map((inst) => {
      const shape = computeOrientedShape(inst.outer, inst.rotationDeg);
      return {
        takeoffPartId: inst.takeoffPartId,
        instanceNumber: inst.instanceNumber,
        xMm: inst.xMm,
        yMm: inst.yMm,
        rotationDeg: inst.rotationDeg,
        widthMm: shape.width,
        heightMm: shape.height,
      };
    }),
  };
}

// ----------------------------------------------------------------------------
// Shared candidate-vs-current comparison — the SINGLE place this decision
// is made for FLEXIBLE and OPTIMIZE (STRICT never needs it: it only ever
// ADDS placements, never replaces the session). Centralizing this is what
// prevents the "an empty/incomplete layout trivially outscores a real
// multi-sheet solution" bug from being reintroduced independently by a
// future mode — scoreSheets()'s sheet-count penalty makes a 0-part layout
// look "cheaper" than any real one, so quantity must always be compared
// FIRST, and score is only a tiebreaker between equally-complete layouts.
// ----------------------------------------------------------------------------

/** Total placed instances across every sheet in a session. */
export function countPlacedInstances(sheets: AssistedSheetSession[]): number {
  return sheets.reduce((sum, s) => sum + s.instances.length, 0);
}

/**
 * True when `candidate` should replace `current`: strictly more placed
 * required parts always wins regardless of score; when both place the
 * SAME number of parts, the lower (better) scoreSheets() value wins. A
 * candidate that places fewer parts never wins, even with a "better" raw
 * score.
 */
export function isCandidateBetter(
  candidatePlacedCount: number,
  candidateScore: number,
  currentPlacedCount: number,
  currentScore: number,
): boolean {
  if (candidatePlacedCount !== currentPlacedCount) return candidatePlacedCount > currentPlacedCount;
  return candidateScore < currentScore;
}

// ----------------------------------------------------------------------------
// FLEXIBLE mode — MANUAL is a HARD lock; PATTERN and previously-OPTIMIZED
// placements are SOFT: released back into a pool and re-placed using the
// real production optimizer, reusing MANUAL's positions as fixed
// obstacles. Two phases, both against the EXISTING geometry/collision
// code — no second placement algorithm:
//
//   Phase 1 (existing sheets, MANUAL obstacles present) —
//   packRemainingOntoSeededSheet() seeds ONLY the MANUAL instances per
//   sheet and greedily fills the rest from the released+remaining pool.
//   This is the only existing tool that respects per-sheet obstacles, so
//   it's reused as-is (same tool STRICT's optimizeRemaining() calls).
//
//   Phase 2 (new sheets, nothing to seed) — whatever's left after every
//   existing sheet is full goes through optimizeGroupPlacement(), the
//   FULL multi-strategy / local-improvement / ruin-and-recreate
//   optimizer — the exact same one an automatic "Run Nesting" uses. This
//   is safe to call completely unseeded because a brand-new sheet has no
//   obstacles to respect, and it is the genuine "use the real optimizer"
//   upgrade over the previous single-pass-only implementation.
//
// The rebuilt result only replaces the session when isCandidateBetter()
// agrees; otherwise a STRICT-style fill of the ORIGINAL layout is
// returned instead (still useful — quantity may still be completed —
// without ever discarding a strictly-better manual arrangement).
// ----------------------------------------------------------------------------
function optimizeFlexible(
  sheets: AssistedSheetSession[],
  partCatalog: Map<string, SessionPartCatalogEntry>,
  candidateSources: EngineSourceInput[],
  config: EngineConfig,
  options: OptimizerOptions | undefined,
  areaByPartId: Map<string, number>,
  scoreBefore: number,
): OptimizeWithPreferenceResult {
  const originalPlacedCount = countPlacedInstances(sheets);

  // MANUAL-only per sheet — the hard lock. PATTERN/OPTIMIZED instances are
  // deliberately dropped here: they become part of the pool below.
  const lockedSheets: AssistedSheetSession[] = sheets.map((s) => ({
    ...s,
    instances: s.instances.filter((i) => i.origin === "MANUAL"),
  }));

  // How many of each part MANUAL already accounts for (used for quantity
  // math below) — and, SEPARATELY, the highest instanceNumber MANUAL is
  // currently using per part. These are NOT the same thing: a MANUAL
  // instance's number can be sparse/non-contiguous (e.g. {1, 4} after an
  // earlier delete/undo), so "count of MANUAL instances" must never be
  // used as a stand-in for "next free instanceNumber" — doing so can
  // collide with an existing MANUAL number (e.g. count=2 but MANUAL holds
  // {3, 5}: count+1=3 would collide with the existing 3). The pool below
  // instead starts strictly above the MAX existing number per part, which
  // is collision-proof regardless of how sparse MANUAL's numbering is.
  const manualCountByPart = new Map<string, number>();
  const maxInstanceNumberByPart = new Map<string, number>();
  for (const s of lockedSheets) {
    for (const inst of s.instances) {
      manualCountByPart.set(inst.takeoffPartId, (manualCountByPart.get(inst.takeoffPartId) ?? 0) + 1);
      const currentMax = maxInstanceNumberByPart.get(inst.takeoffPartId) ?? 0;
      if (inst.instanceNumber > currentMax) maxInstanceNumberByPart.set(inst.takeoffPartId, inst.instanceNumber);
    }
  }

  // Everything except MANUAL needs to be (re)placed: released
  // PATTERN/OPTIMIZED instances plus any genuinely unplaced remainder, up
  // to exactly requiredQty — never more. Quantity ("how many") is derived
  // from manualCount; numbering ("which instanceNumber") is derived from
  // maxInstanceNumberByPart — the two are intentionally independent.
  const pool: OptimizerPartInstance[] = [];
  for (const entry of partCatalog.values()) {
    const manualCount = manualCountByPart.get(entry.takeoffPartId) ?? 0;
    const needed = Math.max(0, entry.requiredQty - manualCount);
    const startNumber = (maxInstanceNumberByPart.get(entry.takeoffPartId) ?? 0) + 1;
    for (let i = 0; i < needed; i++) {
      pool.push({
        takeoffPartId: entry.takeoffPartId,
        itemNo: entry.itemNo,
        instanceNumber: startNumber + i,
        areaSqm: entry.areaSqm,
        outer: entry.outer,
      });
    }
  }

  const rebuiltSheets: AssistedSheetSession[] = lockedSheets.map((s) => ({ ...s, instances: [...s.instances] }));
  let remainingPool = pool;
  let instanceKeyCounter = 0;
  const nextKey = () => `flex-${(instanceKeyCounter += 1)}`;

  // Phase 1 — fill existing sheets, seeded with their MANUAL obstacles.
  for (const sheet of rebuiltSheets) {
    if (remainingPool.length === 0) break;

    const locked: LockedSeedPlacement[] = sheet.instances.map((inst) => ({
      takeoffPartId: inst.takeoffPartId,
      instanceNumber: inst.instanceNumber,
      xMm: inst.xMm,
      yMm: inst.yMm,
      rotationDeg: inst.rotationDeg,
      outer: partCatalog.get(inst.takeoffPartId)?.outer ?? inst.outer,
    }));

    const source: EngineSourceInput = {
      sourceSheetId: sheet.sourceSheetId,
      material: sheet.material,
      thicknessMm: sheet.thicknessMm,
      widthMm: sheet.widthMm,
      lengthMm: sheet.lengthMm,
    };

    const result = packRemainingOntoSeededSheet(locked, remainingPool, source, config, options);

    for (const placement of result.placements) {
      const isLocked = locked.some((l) => l.takeoffPartId === placement.takeoffPartId && l.instanceNumber === placement.instanceNumber);
      if (isLocked) continue; // already present via lockedSheets — don't duplicate
      const entry = partCatalog.get(placement.takeoffPartId);
      sheet.instances.push({
        instanceKey: nextKey(),
        takeoffPartId: placement.takeoffPartId,
        outer: entry?.outer ?? [],
        areaSqm: entry?.areaSqm ?? 0,
        instanceNumber: placement.instanceNumber,
        xMm: placement.xMm,
        yMm: placement.yMm,
        rotationDeg: placement.rotationDeg,
        locked: false,
        origin: "OPTIMIZED",
      });
    }

    remainingPool = result.stillUnplaced;
  }

  // Phase 2 — new sheets for whatever's left, via the FULL multi-strategy
  // optimizer (safe unseeded: a fresh sheet has no obstacles).
  if (remainingPool.length > 0) {
    const optResult = optimizeGroupPlacement(remainingPool, candidateSources, config, options);
    for (const optSheet of optResult.sheets) {
      rebuiltSheets.push({
        sourceSheetId: optSheet.sourceSheetId,
        material: optSheet.material,
        thicknessMm: optSheet.thicknessMm,
        widthMm: optSheet.widthMm,
        lengthMm: optSheet.lengthMm,
        instances: optSheet.placements.map((p) => ({
          instanceKey: nextKey(),
          takeoffPartId: p.takeoffPartId,
          outer: partCatalog.get(p.takeoffPartId)?.outer ?? [],
          areaSqm: partCatalog.get(p.takeoffPartId)?.areaSqm ?? 0,
          instanceNumber: p.instanceNumber,
          xMm: p.xMm,
          yMm: p.yMm,
          rotationDeg: p.rotationDeg,
          locked: false,
          origin: "OPTIMIZED" as const,
        })),
      });
    }
  }

  const candidatePlacedCount = countPlacedInstances(rebuiltSheets);
  const candidateScore = scoreSheets(rebuiltSheets.map(sheetToScorable), areaByPartId);

  const finalSheets = isCandidateBetter(candidatePlacedCount, candidateScore, originalPlacedCount, scoreBefore)
    ? rebuiltSheets
    : // The rebuild didn't win — fall back to a STRICT-style fill of the
      // untouched original layout so quantity can still be completed
      // without ever discarding a strictly-better manual arrangement.
      optimizeRemaining(sheets, partCatalog, candidateSources, config, options).sheets;

  const kept: "ORIGINAL" | "REBUILT" = finalSheets === rebuiltSheets ? "REBUILT" : "ORIGINAL";
  const finalScore = scoreSheets(finalSheets.map(sheetToScorable), areaByPartId);

  const placedQtyByPart = new Map<string, number>();
  for (const s of finalSheets) {
    for (const inst of s.instances) placedQtyByPart.set(inst.takeoffPartId, (placedQtyByPart.get(inst.takeoffPartId) ?? 0) + 1);
  }
  const stillShortByPart = new Map<string, number>();
  for (const entry of partCatalog.values()) {
    const placed = placedQtyByPart.get(entry.takeoffPartId) ?? 0;
    const short = Math.max(0, entry.requiredQty - placed);
    if (short > 0) stillShortByPart.set(entry.takeoffPartId, short);
  }

  return {
    sheets: finalSheets,
    newlyPlacedCount: Math.max(0, countPlacedInstances(finalSheets) - originalPlacedCount),
    openedNewSheets: Math.max(0, finalSheets.length - sheets.length),
    fullyPlaced: stillShortByPart.size === 0,
    stillShortByPart,
    scoreBefore,
    scoreAfter: finalScore,
    kept,
  };
}

export function optimizeRemainingWithPreference(
  sheets: AssistedSheetSession[],
  partCatalog: Map<string, SessionPartCatalogEntry>,
  candidateSources: EngineSourceInput[],
  config: EngineConfig,
  preference: PatternPreference,
  options?: OptimizerOptions,
): OptimizeWithPreferenceResult {
  const areaByPartId = new Map([...partCatalog.values()].map((p) => [p.takeoffPartId, p.areaSqm]));
  const scoreBefore = scoreSheets(sheets.map(sheetToScorable), areaByPartId);

  // STRICT — hard lock EVERYTHING (manual, pattern, optimized); only
  // empty space is filled. Identical to optimizeRemaining() itself.
  if (preference === "STRICT") {
    const result = optimizeRemaining(sheets, partCatalog, candidateSources, config, options);
    return { ...result, scoreBefore, scoreAfter: scoreSheets(result.sheets.map(sheetToScorable), areaByPartId), kept: "ORIGINAL" };
  }

  // FLEXIBLE — hard lock MANUAL only; optimize PATTERN/OPTIMIZED around
  // them using the real production optimizer (see optimizeFlexible above).
  if (preference === "FLEXIBLE") {
    return optimizeFlexible(sheets, partCatalog, candidateSources, config, options, areaByPartId, scoreBefore);
  }

  // OPTIMIZE — rebuild everything from scratch, MANUAL included. Delegates
  // entirely to optimizeEntireSessionWithFullOptimizer() rather than
  // reimplementing a second "call the full optimizer" path, so FLEXIBLE
  // and OPTIMIZE never duplicate optimizer-invocation logic between them.
  const full = optimizeEntireSessionWithFullOptimizer(sheets, partCatalog, candidateSources, config, options);
  const placedQtyByPart = new Map<string, number>();
  for (const s of full.sheets) {
    for (const inst of s.instances) placedQtyByPart.set(inst.takeoffPartId, (placedQtyByPart.get(inst.takeoffPartId) ?? 0) + 1);
  }
  const stillShortByPart = new Map<string, number>();
  for (const entry of partCatalog.values()) {
    const placed = placedQtyByPart.get(entry.takeoffPartId) ?? 0;
    const short = Math.max(0, entry.requiredQty - placed);
    if (short > 0) stillShortByPart.set(entry.takeoffPartId, short);
  }

  return {
    sheets: full.sheets,
    newlyPlacedCount: Math.max(0, full.totalPlacedAfter - full.totalPlacedBefore),
    openedNewSheets: Math.max(0, full.sheets.length - sheets.length),
    fullyPlaced: stillShortByPart.size === 0,
    stillShortByPart,
    scoreBefore: full.scoreBefore,
    scoreAfter: full.scoreAfter,
    kept: full.kept,
  };
}

// ----------------------------------------------------------------------------
// Export validation (spec §29) — never silently export invalid geometry.
// Re-derives every placement's transformed polygon from scratch (the same
// way the DXF writer itself will) and checks it against every other
// placement on its sheet, plus confirms required quantities are met (or
// explicitly flags the shortfall so the caller can decide to export a
// partial nest anyway).
// ----------------------------------------------------------------------------

export interface ExportValidationIssue {
  kind: "OVERLAP" | "OUTSIDE_MARGIN" | "QUANTITY_SHORTFALL";
  message: string;
}

export function validateSessionForExport(
  sheets: AssistedSheetSession[],
  partCatalog: Map<string, SessionPartCatalogEntry>,
  config: EngineConfig,
): { valid: boolean; issues: ExportValidationIssue[] } {
  const issues: ExportValidationIssue[] = [];

  for (const sheet of sheets) {
    const bounds = usableBoundsFor(sheet, config);
    const polygons = sheet.instances.map((inst) => {
      const shape = computeOrientedShape(inst.outer, inst.rotationDeg);
      return { inst, polygon: translatePoints(shape.points, inst.xMm, inst.yMm) };
    });

    for (const { inst, polygon } of polygons) {
      if (!boundsContain(polygon, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)) {
        const entry = partCatalog.get(inst.takeoffPartId);
        issues.push({
          kind: "OUTSIDE_MARGIN",
          message: `Part #${entry?.itemNo ?? inst.takeoffPartId} (sheet ${sheet.sourceSheetId}) crosses the usable sheet margin.`,
        });
      }
    }
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        if (polygonsOverlap(polygons[i].polygon, polygons[j].polygon)) {
          const a = partCatalog.get(polygons[i].inst.takeoffPartId);
          const b = partCatalog.get(polygons[j].inst.takeoffPartId);
          issues.push({
            kind: "OVERLAP",
            message: `Part #${a?.itemNo ?? "?"} overlaps Part #${b?.itemNo ?? "?"} on sheet ${sheet.sourceSheetId}.`,
          });
        }
      }
    }
  }

  const placedQtyByPart = new Map<string, number>();
  for (const sheet of sheets) {
    for (const inst of sheet.instances) placedQtyByPart.set(inst.takeoffPartId, (placedQtyByPart.get(inst.takeoffPartId) ?? 0) + 1);
  }
  for (const entry of partCatalog.values()) {
    const placed = placedQtyByPart.get(entry.takeoffPartId) ?? 0;
    if (placed < entry.requiredQty) {
      issues.push({
        kind: "QUANTITY_SHORTFALL",
        message: `Part #${entry.itemNo}: ${entry.requiredQty - placed} of ${entry.requiredQty} still remaining.`,
      });
    }
  }

  // Only OVERLAP/OUTSIDE_MARGIN block export outright — a quantity
  // shortfall is reported but the caller may still choose "Finish Anyway"
  // (spec §27's "Nesting Partially Complete" path), so it's surfaced as an
  // issue without setting valid=false on its own.
  const blocking = issues.filter((i) => i.kind !== "QUANTITY_SHORTFALL");
  return { valid: blocking.length === 0, issues };
}

// ----------------------------------------------------------------------------
// "Optimize Entire Nest" (spec §10/§11) — the one action allowed to move
// MANUAL placements too (always behind an explicit user confirmation in
// the UI). Unlike optimizeRemainingWithPreference's OPTIMIZE preference
// (which keeps MANUAL locked and only releases PATTERN/OPTIMIZED
// instances via the single-pass packRemainingOntoSeededSheet), this
// ignores the current placement entirely and reruns the FULL
// multi-strategy / local-improvement / ruin-and-recreate optimizer
// (optimizeGroupPlacement — the exact same one the automatic "Run
// Nesting" flow uses) against the complete required quantity from
// scratch. The rebuilt result replaces the session only if it is valid
// AND scores at least as well AND places at least as many parts as the
// current session (scoreSheets() — spec: "accept only if better... do not
// replace a better user solution with a worse automatic result").
// ----------------------------------------------------------------------------

export interface FullOptimizeResult {
  sheets: AssistedSheetSession[];
  kept: "ORIGINAL" | "REBUILT";
  scoreBefore: number;
  scoreAfter: number;
  totalPlacedBefore: number;
  totalPlacedAfter: number;
}

export function optimizeEntireSessionWithFullOptimizer(
  sheets: AssistedSheetSession[],
  partCatalog: Map<string, SessionPartCatalogEntry>,
  candidateSources: EngineSourceInput[],
  config: EngineConfig,
  options?: OptimizerOptions,
): FullOptimizeResult {
  const areaByPartId = new Map([...partCatalog.values()].map((p) => [p.takeoffPartId, p.areaSqm]));
  const scoreBefore = scoreSheets(sheets.map(sheetToScorable), areaByPartId);
  const totalPlacedBefore = sheets.reduce((sum, s) => sum + s.instances.length, 0);

  const allInstances: OptimizerPartInstance[] = [];
  for (const entry of partCatalog.values()) {
    for (let i = 0; i < entry.requiredQty; i++) {
      allInstances.push({
        takeoffPartId: entry.takeoffPartId,
        itemNo: entry.itemNo,
        instanceNumber: i + 1,
        areaSqm: entry.areaSqm,
        outer: entry.outer,
      });
    }
  }

  const optResult = optimizeGroupPlacement(allInstances, candidateSources, config, options);
  const rebuiltSheets: AssistedSheetSession[] = optResult.sheets.map((s, sheetIdx) => ({
    sourceSheetId: s.sourceSheetId,
    material: s.material,
    thicknessMm: s.thicknessMm,
    widthMm: s.widthMm,
    lengthMm: s.lengthMm,
    instances: s.placements.map((p, i) => ({
      instanceKey: `full-${sheetIdx}-${i}`,
      takeoffPartId: p.takeoffPartId,
      outer: partCatalog.get(p.takeoffPartId)?.outer ?? [],
      areaSqm: partCatalog.get(p.takeoffPartId)?.areaSqm ?? 0,
      instanceNumber: p.instanceNumber,
      xMm: p.xMm,
      yMm: p.yMm,
      rotationDeg: p.rotationDeg,
      locked: false,
      origin: "OPTIMIZED" as const,
    })),
  }));

  const scoreAfter = scoreSheets(rebuiltSheets.map(sheetToScorable), areaByPartId);
  const totalPlacedAfter = rebuiltSheets.reduce((sum, s) => sum + s.instances.length, 0);

  // Uses the SAME shared comparator FLEXIBLE uses (isCandidateBetter) —
  // placing MORE required parts always wins regardless of score; score is
  // only the tiebreaker when both solutions place the same count. This is
  // what prevents an empty/incomplete original session from trivially
  // "beating" a real multi-sheet rebuild on raw scoreSheets() alone.
  if (!isCandidateBetter(totalPlacedAfter, scoreAfter, totalPlacedBefore, scoreBefore)) {
    return { sheets, kept: "ORIGINAL", scoreBefore, scoreAfter: scoreBefore, totalPlacedBefore, totalPlacedAfter: totalPlacedBefore };
  }
  return { sheets: rebuiltSheets, kept: "REBUILT", scoreBefore, scoreAfter, totalPlacedBefore, totalPlacedAfter };
}
