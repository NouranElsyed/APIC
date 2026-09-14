// Phase 2C — pure pattern-detection and pattern-expansion logic.
import type { Point } from "./dxf";
import {
  type RotationDeg,
  computeOrientedShape,
  translatePoints,
  polygonsOverlap,
  boundsContain,
  normalizeRotationDeg,
} from "./nesting-geometry";

export interface PatternPlacedInstance {
  takeoffPartId: string;
  outer: Point[];
  areaSqm: number;
  instanceNumber: number;
  xMm: number;
  yMm: number;
  rotationDeg: RotationDeg;
  locked: boolean;
}

export interface PatternSlot {
  takeoffPartId: string;
  outer: Point[];
  areaSqm: number;
  rotationDeg: RotationDeg;
  dxMm: number;
  dyMm: number;
}

export interface DetectedPattern {
  slots: PatternSlot[];
  sourceInstanceCount: number;
  repeatDxMm: number;
  repeatDyMm: number;
  repeatDRotationDeg: number;
}

const POSITION_TOLERANCE_MM = 0.5;
const ROTATION_TOLERANCE_DEG = 0.5;

function approxEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function rotationDelta(fromDeg: number, toDeg: number): number {
  let d = normalizeRotationDeg(toDeg - fromDeg);
  if (d > 180) d -= 360;
  return d;
}

export function detectPattern(instances: PatternPlacedInstance[]): DetectedPattern | null {
  const n = instances.length;
  if (n < 2) return null;

  for (let L = 1; L <= Math.floor(n / 2); L++) {
    const repeats = Math.floor(n / L);
    if (repeats < 2) continue;

    let dx: number | null = null;
    let dy: number | null = null;
    let dRot: number | null = null;
    let consistent = true;

    outer: for (let cycle = 1; cycle < repeats; cycle++) {
      for (let slot = 0; slot < L; slot++) {
        const base = instances[slot];
        const repeated = instances[cycle * L + slot];

        if (base.takeoffPartId !== repeated.takeoffPartId) {
          consistent = false;
          break outer;
        }

        const thisDRot = rotationDelta(base.rotationDeg, repeated.rotationDeg) / cycle;
        const thisDx = (repeated.xMm - base.xMm) / cycle;
        const thisDy = (repeated.yMm - base.yMm) / cycle;

        if (dx === null) {
          dx = thisDx;
          dy = thisDy;
          dRot = thisDRot;
        } else if (
          !approxEqual(thisDx, dx, POSITION_TOLERANCE_MM) ||
          !approxEqual(thisDy, dy!, POSITION_TOLERANCE_MM) ||
          !approxEqual(thisDRot, dRot!, ROTATION_TOLERANCE_DEG)
        ) {
          consistent = false;
          break outer;
        }
      }
    }

    if (consistent && dx !== null && (Math.abs(dx) > POSITION_TOLERANCE_MM || Math.abs(dy!) > POSITION_TOLERANCE_MM || Math.abs(dRot!) > ROTATION_TOLERANCE_DEG)) {
      const slots: PatternSlot[] = instances.slice(0, L).map((inst) => ({
        takeoffPartId: inst.takeoffPartId,
        outer: inst.outer,
        areaSqm: inst.areaSqm,
        rotationDeg: inst.rotationDeg,
        dxMm: inst.xMm - instances[0].xMm,
        dyMm: inst.yMm - instances[0].yMm,
      }));

      return {
        slots,
        sourceInstanceCount: repeats * L,
        repeatDxMm: dx!,
        repeatDyMm: dy!,
        repeatDRotationDeg: dRot!,
      };
    }
  }

  return null;
}

export interface PatternSheetBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ExpandPatternOptions {
  requiredQtyByPart: Map<string, number>;
  placedQtyByPart: Map<string, number>;
  partGapMm: number;
}

export interface GeneratedInstance extends PatternPlacedInstance {
  cycleIndex: number;
  slotIndex: number;
}

export interface ExpandPatternResult {
  generated: GeneratedInstance[];
  fullyApplied: boolean;
  shortfallCycles: number;
  reachedRequiredQuantity: boolean;
}

export function computeRepetitionsNeeded(pattern: DetectedPattern, options: ExpandPatternOptions): number {
  const countInPatternByPart = new Map<string, number>();
  for (const slot of pattern.slots) {
    countInPatternByPart.set(slot.takeoffPartId, (countInPatternByPart.get(slot.takeoffPartId) ?? 0) + 1);
  }

  let maxCyclesNeeded = 0;
  for (const [partId, countPerCycle] of countInPatternByPart) {
    const required = options.requiredQtyByPart.get(partId) ?? 0;
    const placed = options.placedQtyByPart.get(partId) ?? 0;
    const remaining = Math.max(0, required - placed);
    const cyclesForThisPart = Math.ceil(remaining / countPerCycle);
    maxCyclesNeeded = Math.max(maxCyclesNeeded, cyclesForThisPart);
  }
  return maxCyclesNeeded;
}

export function expandPatternOnSheet(
  pattern: DetectedPattern,
  existingInstances: PatternPlacedInstance[],
  sheetBounds: PatternSheetBounds,
  options: ExpandPatternOptions,
): ExpandPatternResult {
  const cyclesNeeded = computeRepetitionsNeeded(pattern, options);

  const committedPolygons: Point[][] = existingInstances.map((inst) => {
    const shape = computeOrientedShape(inst.outer, inst.rotationDeg);
    return translatePoints(shape.points, inst.xMm, inst.yMm);
  });

  const generated: GeneratedInstance[] = [];
  const placedQtyByPart = new Map(options.placedQtyByPart);
  let cyclesPlaced = 0;

  const existingCycles = Math.max(1, Math.round(pattern.sourceInstanceCount / pattern.slots.length));

  for (let i = 1; i <= cyclesNeeded; i++) {
    const cycle = existingCycles + i - 1;

    const cycleWouldHelp = pattern.slots.some((slot) => {
      const required = options.requiredQtyByPart.get(slot.takeoffPartId) ?? 0;
      const placed = placedQtyByPart.get(slot.takeoffPartId) ?? 0;
      return placed < required;
    });
    if (!cycleWouldHelp) break;

    const cycleCandidates: { instance: GeneratedInstance; polygon: Point[] }[] = [];
    let cycleValid = true;
    // BUGFIX (Phase 2C §4): track quantities used so far WITHIN this
    // cycle separately from the committed `placedQtyByPart`. The pattern
    // can reference the same part more than once per cycle (e.g. A,B,A);
    // checking `alreadyPlaced >= required` against the outer map alone
    // let two slots of the same part both pass the same stale count and
    // both get placed, silently exceeding requiredQty. Every slot below
    // must see the effect of every slot processed earlier in this same
    // cycle.
    const withinCycleUsed = new Map(placedQtyByPart);

    for (let slotIndex = 0; slotIndex < pattern.slots.length; slotIndex++) {
      const slot = pattern.slots[slotIndex];

      const required = options.requiredQtyByPart.get(slot.takeoffPartId) ?? 0;
      const alreadyPlaced = withinCycleUsed.get(slot.takeoffPartId) ?? 0;
      if (alreadyPlaced >= required) continue;

      const rotationDeg = normalizeRotationDeg(slot.rotationDeg + pattern.repeatDRotationDeg * cycle);
      const originX = existingInstances[0]?.xMm ?? 0;
      const originY = existingInstances[0]?.yMm ?? 0;
      const finalX = originX + slot.dxMm + pattern.repeatDxMm * cycle;
      const finalY = originY + slot.dyMm + pattern.repeatDyMm * cycle;

      const shape = computeOrientedShape(slot.outer, rotationDeg);
      const polygon = translatePoints(shape.points, finalX, finalY);

      if (!boundsContain(polygon, sheetBounds.minX, sheetBounds.minY, sheetBounds.maxX, sheetBounds.maxY)) {
        cycleValid = false;
        break;
      }

      let collides = false;
      for (const existingPoly of committedPolygons) {
        if (polygonsOverlap(polygon, existingPoly)) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        for (const c of cycleCandidates) {
          if (polygonsOverlap(polygon, c.polygon)) {
            collides = true;
            break;
          }
        }
      }
      if (collides) {
        cycleValid = false;
        break;
      }

      // Reserve this slot's quantity immediately so any later slot in the
      // SAME cycle for the same part sees the updated count.
      withinCycleUsed.set(slot.takeoffPartId, alreadyPlaced + 1);

      cycleCandidates.push({
        instance: {
          takeoffPartId: slot.takeoffPartId,
          outer: slot.outer,
          areaSqm: slot.areaSqm,
          instanceNumber: alreadyPlaced + 1,
          xMm: finalX,
          yMm: finalY,
          rotationDeg,
          locked: false,
          cycleIndex: cycle,
          slotIndex,
        },
        polygon,
      });
    }

    if (!cycleValid) break;

    for (const c of cycleCandidates) {
      generated.push(c.instance);
      committedPolygons.push(c.polygon);
      placedQtyByPart.set(c.instance.takeoffPartId, (placedQtyByPart.get(c.instance.takeoffPartId) ?? 0) + 1);
    }
    cyclesPlaced = i;
  }

  const fullyApplied = cyclesPlaced >= cyclesNeeded;
  const reachedRequiredQuantity = [...new Set(pattern.slots.map((s) => s.takeoffPartId))].every((partId) => {
    const required = options.requiredQtyByPart.get(partId) ?? 0;
    const placed = placedQtyByPart.get(partId) ?? 0;
    return placed >= required;
  });

  return {
    generated,
    fullyApplied,
    shortfallCycles: Math.max(0, cyclesNeeded - cyclesPlaced),
    reachedRequiredQuantity,
  };
}
