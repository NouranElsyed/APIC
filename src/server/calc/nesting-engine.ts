// Phase 2 — the real Nesting Engine.
//
// Pure, framework-free packing algorithm: no Prisma, no HTTP, no React.
// Callers (nesting-run.service.ts) build EnginePartInput[] / EngineSourceInput[]
// from the database, call runNestingAlgorithm(), and persist the result.
// This separation is what lets the engine be unit tested directly (see
// nesting-engine.test.ts) and swapped out for a better optimizer later
// without touching persistence or API code (see PROJECT.md §20).
//
// Algorithm: deterministic shelf / bottom-left first-fit.
//   - Parts are sorted deterministically (largest area first, then largest
//     bounding dimension, then item number) so the same inputs always
//     produce the same layout.
//   - Each sheet is packed left-to-right in "shelves" (rows): a part is
//     placed at the current cursor if it fits the remaining row width and
//     height; otherwise a new shelf is started above the tallest part
//     placed so far in the current row. If no more shelves fit on the
//     sheet, the engine moves on to the next available source sheet.
//   - Every candidate placement is tried at 0/90/180/270 degree rotations;
//     the first rotation (in that preference order) that fits the current
//     shelf is used.
//   - Because each placement reserves its full rotated bounding box on the
//     shelf, bounding boxes never overlap by construction; a second, exact
//     polygon-vs-polygon check (Stage 2) is still run before a placement is
//     accepted, so a future denser packer can reuse this validation as-is.
//
// Source sheets are treated as an UNLIMITED, purchasable stock (PROJECT.md
// §2/§3): a NestingSource describes a material/thickness/size that can be
// bought as many times as needed, never a fixed inventory count. The engine
// therefore opens as many physical sheets of a given source definition as
// required to place every part, and reports back how many of each source
// definition it actually used — that count is the "required purchase
// quantity" surfaced to the user (see NestingAlgorithmResult.sourceRequirements
// and PROJECT.md §16/§23). The only thing that can legitimately stop a part
// from being placed is geometry (it doesn't fit any known sheet size /
// margins / gap), never running out of "quantity".
//
// This intentionally is NOT an industrial-grade optimizer (see PROJECT.md
// §3) — it optimizes for correctness, determinism, and a clean extension
// point, not maximum utilization.

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

export const ALGORITHM_NAME = "shelf-bottom-left-first-fit";
export const ALGORITHM_VERSION = "3.0.0";

// Per-side sheet margins (PROJECT.md §7/§8) plus the minimum required gap
// between two different parts (PROJECT.md §6). All values are millimeters
// and all are configurable per Nesting Run — never hard-coded.
export interface EngineConfig {
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  partGapMm: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  marginLeftMm: 5,
  marginRightMm: 5,
  marginTopMm: 5,
  marginBottomMm: 5,
  partGapMm: 0,
};

export interface EnginePartInput {
  takeoffPartId: string;
  itemNo: number;
  material: string;
  thicknessMm: number;
  qty: number;
  areaSqm: number; // real DXF-derived area, one instance
  outer: Point[]; // mm-space outer contour, one instance, untransformed
}

// A purchasable source sheet definition — material + thickness + size.
// There is deliberately NO quantity field here: the engine treats every
// definition as available an unlimited number of times to purchase, and
// reports back how many were actually required (see sourceRequirements on
// NestingAlgorithmResult). `availableQty`, if present on the caller's
// underlying record, is informational stock only and is never read by the
// engine (PROJECT.md §4).
export interface EngineSourceInput {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
}

export type UnplacedReason =
  | "NO_SOURCE_SHEET"
  | "INSUFFICIENT_SHEET_AREA"
  | "PART_TOO_LARGE"
  | "NO_VALID_PLACEMENT";

export interface UnplacedPart {
  takeoffPartId: string;
  itemNo: number;
  material: string;
  thicknessMm: number;
  requiredQty: number;
  placedQty: number;
  remainingQty: number;
  reason: UnplacedReason;
}

export interface EnginePlacementResult {
  takeoffPartId: string;
  instanceNumber: number; // 1-based within (run, part) — matches schema
  xMm: number;
  yMm: number;
  rotationDeg: RotationDeg;
  widthMm: number; // rotated bounding-box dimensions, for the SVG preview
  heightMm: number;
}

export interface EngineSheetResult {
  sheetNumber: number; // global, 1-based across the whole run
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  usedAreaSqm: number;
  scrapAreaSqm: number;
  utilizationPercent: number;
  placements: EnginePlacementResult[];
}

export interface EngineGroupResult {
  key: string; // "material||thicknessMm"
  material: string;
  thicknessMm: number;
  partsRequired: number;
  partsPlaced: number;
  partsUnplaced: number;
  sheets: EngineSheetResult[];
}

// The automatically-calculated purchasing requirement for one source sheet
// definition (PROJECT.md §3/§16): "to manufacture all required parts, buy
// `requiredQty` sheets of widthMm × lengthMm × thicknessMm `material`."
export interface SourceRequirement {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  requiredQty: number;
}

export interface NestingAlgorithmResult {
  algorithmName: string;
  algorithmVersion: string;
  config: EngineConfig;
  groups: EngineGroupResult[];
  totalSheetsUsed: number;
  totalUsedAreaSqm: number;
  totalScrapAreaSqm: number;
  overallUtilizationPercent: number;
  totalPartsRequired: number;
  totalPartsPlaced: number;
  totalPartsUnplaced: number;
  unplacedParts: UnplacedPart[];
  sourceRequirements: SourceRequirement[];
}

function groupKey(material: string, thicknessMm: number): string {
  return `${material}||${thicknessMm}`;
}

// One expanded instance of a part awaiting placement — "part #4, copy 2 of
// 6" — carrying everything the packer needs without re-deriving it.
interface PartInstance {
  takeoffPartId: string;
  itemNo: number;
  instanceNumber: number;
  areaSqm: number;
  outer: Point[];
  rawBBox: BoundingBox;
}

// One physical sheet actually opened during packing. Tracks shelf-packing
// cursor state plus every accepted placement's final polygon (for the
// Stage 2 accurate overlap check against later placements on the same sheet).
class SheetPacker {
  readonly sourceSheetId: string;
  readonly material: string;
  readonly thicknessMm: number;
  readonly widthMm: number;
  readonly lengthMm: number;

  private readonly minX: number;
  private readonly minY: number;
  private readonly maxX: number;
  private readonly maxY: number;
  private readonly gap: number;

  private cursorX: number;
  private cursorY: number;
  private shelfHeight = 0;

  private placedPolygons: Point[][] = [];
  readonly placements: EnginePlacementResult[] = [];
  private instanceCounters = new Map<string, number>();

  constructor(source: EngineSourceInput, config: EngineConfig) {
    this.sourceSheetId = source.sourceSheetId;
    this.material = source.material;
    this.thicknessMm = source.thicknessMm;
    this.widthMm = source.widthMm;
    this.lengthMm = source.lengthMm;

    // Sheet margins (PROJECT.md §7): the usable nesting area is the
    // physical sheet shrunk by each side's own margin — never a single
    // uniform "edge clearance". The physical sheet boundary exported to
    // DXF always stays the full widthMm × lengthMm regardless of these.
    this.minX = config.marginLeftMm;
    this.minY = config.marginBottomMm;
    this.maxX = source.widthMm - config.marginRightMm;
    this.maxY = source.lengthMm - config.marginTopMm;
    this.gap = config.partGapMm;

    this.cursorX = this.minX;
    this.cursorY = this.minY;
  }

  get usableWidth(): number {
    return Math.max(0, this.maxX - this.minX);
  }
  get usableHeight(): number {
    return Math.max(0, this.maxY - this.minY);
  }

  // Attempts to place one part instance. Returns true and records the
  // placement if successful; returns false (and leaves all state
  // unchanged) if the instance cannot fit anywhere remaining on this sheet.
  tryPlace(instance: PartInstance): boolean {
    if (this.usableWidth <= 0 || this.usableHeight <= 0) return false;

    // Attempt 1: fits in the current shelf row without starting a new one.
    let placement = this.attemptAtCursor(instance, this.cursorX, this.cursorY, this.maxX - this.cursorX, this.maxY - this.cursorY);

    // Attempt 2: start a new shelf above the current row.
    if (!placement) {
      const nextY = this.cursorY + this.shelfHeight + (this.shelfHeight > 0 ? this.gap : 0);
      if (nextY < this.maxY) {
        placement = this.attemptAtCursor(instance, this.minX, nextY, this.maxX - this.minX, this.maxY - nextY);
        if (placement) {
          this.cursorX = this.minX;
          this.cursorY = nextY;
          this.shelfHeight = 0;
        }
      }
    }

    if (!placement) return false;

    const { shape, x, y, polygon } = placement;

    this.cursorX = x + shape.width + this.gap;
    this.shelfHeight = Math.max(this.shelfHeight, shape.height);
    this.placedPolygons.push(polygon);

    const nextInstanceNumber = (this.instanceCounters.get(instance.takeoffPartId) ?? 0) + 1;
    this.instanceCounters.set(instance.takeoffPartId, nextInstanceNumber);

    this.placements.push({
      takeoffPartId: instance.takeoffPartId,
      instanceNumber: instance.instanceNumber,
      xMm: x,
      yMm: y,
      rotationDeg: shape.rotationDeg,
      widthMm: shape.width,
      heightMm: shape.height,
    });
    return true;
  }

  // Whether this part instance could ever fit on a brand-new, empty sheet
  // of this exact size — used to distinguish PART_TOO_LARGE from
  // INSUFFICIENT_SHEET_AREA when placement fails.
  couldEverFit(instance: PartInstance): boolean {
    for (const rotation of SUPPORTED_ROTATIONS) {
      const shape = computeOrientedShape(instance.outer, rotation);
      if (shape.width <= this.usableWidth + 1e-6 && shape.height <= this.usableHeight + 1e-6) return true;
    }
    return false;
  }

  private attemptAtCursor(
    instance: PartInstance,
    x: number,
    y: number,
    availWidth: number,
    availHeight: number,
  ): { shape: ReturnType<typeof computeOrientedShape>; x: number; y: number; polygon: Point[] } | null {
    for (const rotation of SUPPORTED_ROTATIONS) {
      const shape = computeOrientedShape(instance.outer, rotation);
      if (shape.width > availWidth + 1e-6 || shape.height > availHeight + 1e-6) continue;

      const polygon = translatePoints(shape.points, x, y);
      const candidateBBox: BoundingBox = {
        minX: x,
        minY: y,
        maxX: x + shape.width,
        maxY: y + shape.height,
        width: shape.width,
        height: shape.height,
      };

      // Boundary check (Stage 0 — must stay within the margin-adjusted usable area).
      if (!boundsContain(polygon, this.minX, this.minY, this.maxX, this.maxY)) {
        continue;
      }

      // Stage 1 — fast bounding-box collision check against everything
      // already placed on this sheet.
      let bboxCollision = false;
      for (const existing of this.placements) {
        const existingBBox: BoundingBox = {
          minX: existing.xMm,
          minY: existing.yMm,
          maxX: existing.xMm + existing.widthMm,
          maxY: existing.yMm + existing.heightMm,
          width: existing.widthMm,
          height: existing.heightMm,
        };
        if (aabbOverlap(candidateBBox, existingBBox)) {
          bboxCollision = true;
          break;
        }
      }
      if (bboxCollision) continue;

      // Stage 2 — accurate polygon-vs-polygon overlap check. With shelf
      // packing this should never trip given Stage 1 already passed, but
      // it is the authoritative guard against overlap (PROJECT.md §7) and
      // stays in place for any future denser placement strategy.
      let polygonCollision = false;
      for (const existingPolygon of this.placedPolygons) {
        if (polygonsOverlap(polygon, existingPolygon)) {
          polygonCollision = true;
          break;
        }
      }
      if (polygonCollision) continue;

      return { shape, x, y, polygon };
    }
    return null;
  }
}

function expandPartInstances(parts: EnginePartInput[]): PartInstance[] {
  const instances: PartInstance[] = [];
  for (const part of parts) {
    const rawBBox = computeBoundingBox(part.outer);
    for (let i = 1; i <= part.qty; i++) {
      instances.push({
        takeoffPartId: part.takeoffPartId,
        itemNo: part.itemNo,
        instanceNumber: i,
        areaSqm: part.areaSqm,
        outer: part.outer,
        rawBBox,
      });
    }
  }

  // Deterministic sort: largest actual area first, then largest
  // bounding-box dimension, then item number, then instance number
  // (PROJECT.md §21). Placing big parts first is a standard, effective
  // heuristic for shelf/first-fit packers.
  return instances.sort((a, b) => {
    if (b.areaSqm !== a.areaSqm) return b.areaSqm - a.areaSqm;
    const maxDimA = Math.max(a.rawBBox.width, a.rawBBox.height);
    const maxDimB = Math.max(b.rawBBox.width, b.rawBBox.height);
    if (maxDimB !== maxDimA) return maxDimB - maxDimA;
    if (a.itemNo !== b.itemNo) return a.itemNo - b.itemNo;
    return a.instanceNumber - b.instanceNumber;
  });
}

function runGroup(
  material: string,
  thicknessMm: number,
  parts: EnginePartInput[],
  sources: EngineSourceInput[],
  config: EngineConfig,
  nextSheetNumber: () => number,
): EngineGroupResult {
  const instances = expandPartInstances(parts);

  const openPackers: SheetPacker[] = [];
  // Sources are unlimited to purchase (PROJECT.md §2): rather than
  // pre-expanding a finite pool, we cycle through the distinct source
  // definitions declared for this group, opening a brand-new physical
  // sheet each time one is needed. The final per-source open count (see
  // sourceRequirements below) is simply "how many times did we open a
  // sheet of this definition".
  let cycleIndex = 0;

  function openNextSheet(): SheetPacker | null {
    if (sources.length === 0) return null;
    const sourceDef = sources[cycleIndex % sources.length];
    cycleIndex++;
    const packer = new SheetPacker(sourceDef, config);
    openPackers.push(packer);
    return packer;
  }

  // Per-part-id running tally so the final unplaced-parts report always
  // reflects reality even though instances are interleaved across parts.
  const placedCountByPart = new Map<string, number>();
  const failureReasonByPart = new Map<string, UnplacedReason>();

  for (const instance of instances) {
    let placed = false;

    // Try every sheet already opened for this group first (bottom-left /
    // first-fit across sheets, not just the most recent one).
    for (const packer of openPackers) {
      if (packer.tryPlace(instance)) {
        placed = true;
        break;
      }
    }

    // Open new sheets — one purchasable definition at a time — until the
    // instance fits. Since supply is unlimited, the only thing that can
    // stop this is having already tried a fresh sheet of every distinct
    // source size/definition without success; trying more copies of sizes
    // already proven not to fit would never help, so fresh-sheet attempts
    // are capped at `sources.length` per instance rather than looping
    // forever.
    if (!placed) {
      let freshAttempts = 0;
      while (!placed && freshAttempts < sources.length) {
        const packer = openNextSheet();
        if (!packer) break;
        freshAttempts++;
        if (packer.tryPlace(instance)) placed = true;
      }
    }

    if (placed) {
      placedCountByPart.set(instance.takeoffPartId, (placedCountByPart.get(instance.takeoffPartId) ?? 0) + 1);
      continue;
    }

    // Determine why. Prefer the most specific/actionable reason and never
    // downgrade a reason already recorded for this part.
    let reason: UnplacedReason;
    if (sources.length === 0) {
      reason = "NO_SOURCE_SHEET";
    } else {
      const fitsAnyKnownSheetSize = sources.some((s) => {
        const probe = new SheetPacker(s, config);
        return probe.couldEverFit(instance);
      });
      reason = fitsAnyKnownSheetSize ? "INSUFFICIENT_SHEET_AREA" : "PART_TOO_LARGE";
    }
    if (!failureReasonByPart.has(instance.takeoffPartId)) {
      failureReasonByPart.set(instance.takeoffPartId, reason);
    }
  }

  // Build sheet results only for sheets that actually received placements —
  // an opened-but-empty trailing sheet (e.g. the loop opened one more sheet
  // than needed while probing) is not persisted.
  const usedPackers = openPackers.filter((p) => p.placements.length > 0);
  const sheets: EngineSheetResult[] = usedPackers.map((packer) => {
    const sheetAreaSqm = (packer.widthMm * packer.lengthMm) / 1_000_000;
    const usedAreaSqm = packer.placements.reduce((sum, placement) => {
      const part = parts.find((p) => p.takeoffPartId === placement.takeoffPartId);
      return sum + (part?.areaSqm ?? 0);
    }, 0);
    const scrapAreaSqm = Math.max(0, sheetAreaSqm - usedAreaSqm);
    const utilizationPercent = sheetAreaSqm > 0 ? (usedAreaSqm / sheetAreaSqm) * 100 : 0;

    return {
      sheetNumber: nextSheetNumber(),
      sourceSheetId: packer.sourceSheetId,
      material: packer.material,
      thicknessMm: packer.thicknessMm,
      widthMm: packer.widthMm,
      lengthMm: packer.lengthMm,
      usedAreaSqm,
      scrapAreaSqm,
      utilizationPercent,
      placements: packer.placements,
    };
  });

  const partsRequired = parts.reduce((sum, p) => sum + p.qty, 0);
  const partsPlaced = [...placedCountByPart.values()].reduce((sum, n) => sum + n, 0);

  return {
    key: groupKey(material, thicknessMm),
    material,
    thicknessMm,
    partsRequired,
    partsPlaced,
    partsUnplaced: partsRequired - partsPlaced,
    sheets,
  };
}

// Entry point. Pure function: same inputs always produce the same output
// (PROJECT.md §21) — no randomness, no wall-clock-dependent behavior.
export function runNestingAlgorithm(
  parts: EnginePartInput[],
  sources: EngineSourceInput[],
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): NestingAlgorithmResult {
  const partsByGroup = new Map<string, EnginePartInput[]>();
  for (const part of parts) {
    const key = groupKey(part.material, part.thicknessMm);
    const list = partsByGroup.get(key) ?? [];
    list.push(part);
    partsByGroup.set(key, list);
  }

  const sourcesByGroup = new Map<string, EngineSourceInput[]>();
  for (const source of sources) {
    const key = groupKey(source.material, source.thicknessMm);
    const list = sourcesByGroup.get(key) ?? [];
    list.push(source);
    sourcesByGroup.set(key, list);
  }

  // Deterministic group order: material, then thickness.
  const groupKeys = [...partsByGroup.keys()].sort((a, b) => a.localeCompare(b));

  let sheetCounter = 0;
  const nextSheetNumber = () => ++sheetCounter;

  const groups: EngineGroupResult[] = groupKeys.map((key) => {
    const groupParts = partsByGroup.get(key)!;
    const { material, thicknessMm } = groupParts[0];
    const groupSources = sourcesByGroup.get(key) ?? [];
    return runGroup(material, thicknessMm, groupParts, groupSources, config, nextSheetNumber);
  });

  // Build the flat unplaced-parts report from each group's per-part tallies.
  const unplacedParts: UnplacedPart[] = [];
  for (const key of groupKeys) {
    const groupParts = partsByGroup.get(key)!;
    const groupSources = sourcesByGroup.get(key) ?? [];
    const group = groups.find((g) => g.key === key)!;

    const placedByPart = new Map<string, number>();
    for (const sheet of group.sheets) {
      for (const placement of sheet.placements) {
        placedByPart.set(placement.takeoffPartId, (placedByPart.get(placement.takeoffPartId) ?? 0) + 1);
      }
    }

    for (const part of groupParts) {
      const placedQty = placedByPart.get(part.takeoffPartId) ?? 0;
      const remainingQty = part.qty - placedQty;
      if (remainingQty <= 0) continue;

      let reason: UnplacedReason;
      if (groupSources.length === 0) {
        reason = "NO_SOURCE_SHEET";
      } else {
        const fitsAnyKnownSheetSize = groupSources.some((s) => {
          const probe = new SheetPacker(s, config);
          return probe.couldEverFit({
            takeoffPartId: part.takeoffPartId,
            itemNo: part.itemNo,
            instanceNumber: 1,
            areaSqm: part.areaSqm,
            outer: part.outer,
            rawBBox: computeBoundingBox(part.outer),
          });
        });
        reason = fitsAnyKnownSheetSize ? "INSUFFICIENT_SHEET_AREA" : "PART_TOO_LARGE";
      }

      unplacedParts.push({
        takeoffPartId: part.takeoffPartId,
        itemNo: part.itemNo,
        material: part.material,
        thicknessMm: part.thicknessMm,
        requiredQty: part.qty,
        placedQty,
        remainingQty,
        reason,
      });
    }
  }

  const totalSheetsUsed = groups.reduce((sum, g) => sum + g.sheets.length, 0);
  const totalUsedAreaSqm = groups.reduce((sum, g) => sum + g.sheets.reduce((s, sh) => s + sh.usedAreaSqm, 0), 0);
  const totalSheetAreaSqm = groups.reduce(
    (sum, g) => sum + g.sheets.reduce((s, sh) => s + (sh.widthMm * sh.lengthMm) / 1_000_000, 0),
    0,
  );
  const totalScrapAreaSqm = Math.max(0, totalSheetAreaSqm - totalUsedAreaSqm);
  const overallUtilizationPercent = totalSheetAreaSqm > 0 ? (totalUsedAreaSqm / totalSheetAreaSqm) * 100 : 0;

  const totalPartsRequired = groups.reduce((sum, g) => sum + g.partsRequired, 0);
  const totalPartsPlaced = groups.reduce((sum, g) => sum + g.partsPlaced, 0);
  const totalPartsUnplaced = totalPartsRequired - totalPartsPlaced;

  // Required purchase quantity per source definition (PROJECT.md §3/§16):
  // simply how many actually-used sheets (sheets.length > 0 placements)
  // came from each sourceSheetId, tallied across every group.
  const requirementBySourceId = new Map<string, SourceRequirement>();
  for (const group of groups) {
    for (const sheet of group.sheets) {
      const existing = requirementBySourceId.get(sheet.sourceSheetId);
      if (existing) {
        existing.requiredQty += 1;
      } else {
        requirementBySourceId.set(sheet.sourceSheetId, {
          sourceSheetId: sheet.sourceSheetId,
          material: sheet.material,
          thicknessMm: sheet.thicknessMm,
          widthMm: sheet.widthMm,
          lengthMm: sheet.lengthMm,
          requiredQty: 1,
        });
      }
    }
  }
  const sourceRequirements = [...requirementBySourceId.values()].sort(
    (a, b) => a.material.localeCompare(b.material) || a.thicknessMm - b.thicknessMm || a.widthMm - b.widthMm,
  );

  return {
    algorithmName: ALGORITHM_NAME,
    algorithmVersion: ALGORITHM_VERSION,
    config,
    groups,
    totalSheetsUsed,
    totalUsedAreaSqm,
    totalScrapAreaSqm,
    overallUtilizationPercent,
    totalPartsRequired,
    totalPartsPlaced,
    totalPartsUnplaced,
    unplacedParts,
    sourceRequirements,
  };
}
