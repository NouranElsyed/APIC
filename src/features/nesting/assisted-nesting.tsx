"use client";
// Phase 2C — Interactive Pattern-Assisted Nesting.
//
// A CAD-style manual placement canvas: the user picks a part, moves the
// mouse to position it, scrolls the wheel to rotate it, and clicks to
// commit. Once two or more compatible instances have been placed, the
// pattern engine (nesting-pattern.ts) detects the repeating relationship
// and offers to repeat it automatically for the remaining quantity.
//
// Every transform/collision check here goes through the SAME primitives
// used by the automatic engine and optimizer (nesting-geometry.ts) — there
// is no separate/simplified validation path, so a placement that's valid
// here is guaranteed valid everywhere else (preview, DXF export, the
// automatic optimizer) too.
//
// This component is intentionally self-contained (no API calls): it holds
// its session in React state and reports the final instance list via
// `onChange`/`onFinish`, so a caller can wire it up to persistence
// (a future NestingPlacement.source field, see PROJECT notes) without this
// file needing to know about Prisma or routing.

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Trash2, Wand2, X, CheckCircle2, AlertTriangle, Lock, Sparkles, Download } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import type { Point } from "./types";
import {
  computeOrientedShape,
  translatePoints,
  polygonsOverlap,
  boundsContain,
  computeBoundingBox,
  findNearestValidOrigin,
  type RotationDeg,
} from "@/server/calc/nesting-geometry";
import {
  detectPattern,
  expandPatternOnSheet,
  type PatternPlacedInstance,
  type DetectedPattern,
  type PatternSheetBounds,
} from "@/server/calc/nesting-pattern";
import {
  optimizeRemainingWithPreference,
  optimizeEntireSessionWithFullOptimizer,
  validateSessionForExport,
  type AssistedSheetSession,
  type SessionPartCatalogEntry,
  type PatternPreference,
} from "@/server/calc/nesting-assisted-session";
import type { EngineSourceInput } from "@/server/calc/nesting-engine";
import { writeNestingSheetDxf, nestingSheetDxfFileName } from "@/server/calc/nesting-dxf-writer";

export interface AssistedPart {
  takeoffPartId: string;
  itemNo: number;
  description: string;
  requiredQty: number;
  areaSqm: number;
  outer: Point[];
  holes: Point[][];
}

export interface AssistedSheetConfig {
  widthMm: number;
  lengthMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  partGapMm: number;
}

export interface AssistedInstance {
  id: string;
  takeoffPartId: string;
  instanceNumber: number;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  locked: boolean; // manual placements are locked by default
  origin: "MANUAL" | "PATTERN" | "OPTIMIZED";
}

export interface AssistedSheetIdentity {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
}

const DEFAULT_ROTATION_STEP_DEG = 5;

type InvalidReason = "OVERLAPS_EXISTING_PART" | "OUTSIDE_SHEET" | "CROSSES_MARGIN" | null;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function sheetBounds(config: AssistedSheetConfig): PatternSheetBounds {
  // Axis convention: lengthMm runs along X (horizontal), widthMm runs
  // along Y (vertical) — matches nesting-engine.ts and the DXF writer.
  return {
    minX: config.marginLeftMm,
    minY: config.marginBottomMm,
    maxX: config.lengthMm - config.marginRightMm,
    maxY: config.widthMm - config.marginTopMm,
  };
}

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z";
}

interface SheetHistoryEntry {
  instances: AssistedInstance[];
}

/**
 * One sheet within the assisted-nesting session — its own identity
 * (material/thickness/size, same group as every other sheet in this
 * canvas) plus its own independent undo/redo history (spec §13
 * "History must be sheet-aware"). Every sheet gets the exact same
 * interactive canvas; there is no read-only sheet anymore.
 */
interface SheetSessionState {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  history: SheetHistoryEntry[];
  historyIndex: number;
}

function instToAssisted(i: { instanceKey: string; takeoffPartId: string; instanceNumber: number; xMm: number; yMm: number; rotationDeg: number; locked: boolean; origin: "MANUAL" | "PATTERN" | "OPTIMIZED" }): AssistedInstance {
  return {
    id: i.instanceKey,
    takeoffPartId: i.takeoffPartId,
    instanceNumber: i.instanceNumber,
    xMm: i.xMm,
    yMm: i.yMm,
    rotationDeg: i.rotationDeg,
    locked: i.locked,
    origin: i.origin,
  };
}

function sameInstanceSet(a: AssistedInstance[], b: AssistedInstance[]): boolean {
  if (a.length !== b.length) return false;
  const key = (list: AssistedInstance[]) =>
    list
      .map((i) => `${i.id}:${i.xMm.toFixed(3)}:${i.yMm.toFixed(3)}:${i.rotationDeg.toFixed(3)}:${i.origin}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

export function AssistedNestingCanvas({
  parts,
  sheetConfig,
  sheetIdentity,
  candidateSources,
  rotationStepDeg = DEFAULT_ROTATION_STEP_DEG,
  jobId,
  initialSheets,
  initialRunId,
  onExit,
  onFinish,
}: {
  parts: AssistedPart[];
  sheetConfig: AssistedSheetConfig;
  /** Identity of the sheet definition currently being nested on — used to seed the optimizer session and to name/label exported DXFs. */
  sheetIdentity: AssistedSheetIdentity;
  /** Additional compatible source sheet definitions the optimizer may open when the current sheet runs out of room (spec §22/§23). Defaults to just `sheetIdentity` repeated (i.e. more of the same sheet). */
  candidateSources?: EngineSourceInput[];
  rotationStepDeg?: number;
  /** The NestingJob this session belongs to — required to persist via POST /api/nesting/jobs/:id/assisted. If omitted, "Finish Assisted Nesting" falls back to the in-memory-only onFinish callback. */
  jobId?: string;
  /** Reopens a previously saved assisted run (spec §5 "Saved Assisted Run → Editable Session") — one entry per sheet, each with its already-placed instances. When provided, this becomes the session's starting state instead of an empty single sheet. */
  initialSheets?: { sourceSheetId: string; material: string; thicknessMm: number; widthMm: number; lengthMm: number; instances: AssistedInstance[] }[];
  /** The NestingRun.id this session was loaded from, if any — lets "Finish Assisted Nesting" show as "Save Changes" and skip a no-op save when nothing changed. */
  initialRunId?: string;
  onExit?: () => void;
  onFinish?: (instances: AssistedInstance[]) => void;
}) {
  const partsById = React.useMemo(() => new Map(parts.map((p) => [p.takeoffPartId, p])), [parts]);

  const [sheetSessions, setSheetSessions] = React.useState<SheetSessionState[]>(() => {
    if (initialSheets && initialSheets.length > 0) {
      return initialSheets.map((s) => ({
        sourceSheetId: s.sourceSheetId,
        material: s.material,
        thicknessMm: s.thicknessMm,
        widthMm: s.widthMm,
        lengthMm: s.lengthMm,
        history: [{ instances: s.instances }],
        historyIndex: 0,
      }));
    }
    return [
      {
        sourceSheetId: sheetIdentity.sourceSheetId,
        material: sheetIdentity.material,
        thicknessMm: sheetIdentity.thicknessMm,
        widthMm: sheetConfig.widthMm,
        lengthMm: sheetConfig.lengthMm,
        history: [{ instances: [] }],
        historyIndex: 0,
      },
    ];
  });
  const [activeSheetIndex, setActiveSheetIndex] = React.useState(0);
  const [dirty, setDirty] = React.useState(false);

  const activeSheet = sheetSessions[activeSheetIndex];
  const instances = activeSheet.history[activeSheet.historyIndex].instances;
  // Margins/gap are shared across every sheet in this session (all sheets
  // belong to the same material/thickness group); only width/length can
  // legitimately differ between sheets, since a compatible source sheet
  // definition can come in more than one size.
  const activeSheetConfig: AssistedSheetConfig = {
    ...sheetConfig,
    widthMm: activeSheet.widthMm,
    lengthMm: activeSheet.lengthMm,
  };
  const bounds = React.useMemo(() => sheetBounds(activeSheetConfig), [activeSheetConfig]);

  const [selectedPartId, setSelectedPartId] = React.useState<string | null>(parts[0]?.takeoffPartId ?? null);
  const [placing, setPlacing] = React.useState(false);
  const [cursor, setCursor] = React.useState<Point | null>(null);
  const [ghostRotation, setGhostRotation] = React.useState<RotationDeg>(0);
  const [selectedInstanceId, setSelectedInstanceId] = React.useState<string | null>(null);
  // Double-click-to-replace (Phase 2C §2): the id of the committed
  // instance currently being repositioned, or null when not replacing.
  // While set, that instance is excluded from the collision set and from
  // the committed-instance render list, and appears only as the moving
  // ghost. We deliberately never mutate `instances` until the user clicks
  // a valid new spot — Esc just clears this ref, and since the original
  // instance was never touched, the "restore" is automatic and exact.
  const [replacingInstanceId, setReplacingInstanceId] = React.useState<string | null>(null);

  const svgRef = React.useRef<SVGSVGElement | null>(null);

  // React attaches onWheel as a PASSIVE listener, so e.preventDefault()
  // inside a React onWheel handler is silently ignored by the browser and
  // the page scrolls anyway while the user is rotating a part. Attaching a
  // native, non-passive listener is the only reliable fix.
  const placingRef = React.useRef(placing);
  React.useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  React.useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const nativeWheelHandler = (e: WheelEvent) => {
      if (!placingRef.current) return;
      e.preventDefault();
      setGhostRotation((r) => {
        const delta = e.deltaY > 0 ? -rotationStepDeg : rotationStepDeg;
        const next = (r + delta) % 360;
        return next < 0 ? next + 360 : next;
      });
    };
    el.addEventListener("wheel", nativeWheelHandler, { passive: false });
    return () => el.removeEventListener("wheel", nativeWheelHandler);
  }, [rotationStepDeg]);

  function commitHistory(nextInstances: AssistedInstance[]) {
    setSheetSessions((prev) =>
      prev.map((s, i) => {
        if (i !== activeSheetIndex) return s;
        const truncated = s.history.slice(0, s.historyIndex + 1);
        return { ...s, history: [...truncated, { instances: nextInstances }], historyIndex: truncated.length };
      }),
    );
    setDirty(true);
  }

  function undo() {
    setSheetSessions((prev) => prev.map((s, i) => (i !== activeSheetIndex ? s : { ...s, historyIndex: Math.max(0, s.historyIndex - 1) })));
    setReplacingInstanceId(null);
    setPlacing(false);
  }
  function redo() {
    setSheetSessions((prev) =>
      prev.map((s, i) => (i !== activeSheetIndex ? s : { ...s, historyIndex: Math.min(s.history.length - 1, s.historyIndex + 1) })),
    );
    setReplacingInstanceId(null);
    setPlacing(false);
  }

  function addSheet() {
    setSheetSessions((prev) => [
      ...prev,
      {
        sourceSheetId: sheetIdentity.sourceSheetId,
        material: sheetIdentity.material,
        thicknessMm: sheetIdentity.thicknessMm,
        widthMm: sheetConfig.widthMm,
        lengthMm: sheetConfig.lengthMm,
        history: [{ instances: [] }],
        historyIndex: 0,
      },
    ]);
    setActiveSheetIndex(sheetSessions.length); // the index the new sheet will occupy
    setDirty(true);
  }

  /** Merges a multi-sheet optimizer result back in — ONE history entry per sheet that actually changed (spec §13: "one history transaction per operation", never per generated placement), plus appends brand-new sheets the optimizer opened. */
  function applyMultiSheetResult(resultSheets: AssistedSheetSession[]) {
    setSheetSessions((prev) => {
      const next: SheetSessionState[] = prev.map((sess, i) => {
        const updated = resultSheets[i];
        if (!updated) return sess;
        const newInstances = updated.instances.map(instToAssisted);
        const current = sess.history[sess.historyIndex].instances;
        if (sameInstanceSet(current, newInstances)) return sess;
        const truncated = sess.history.slice(0, sess.historyIndex + 1);
        return { ...sess, history: [...truncated, { instances: newInstances }], historyIndex: truncated.length };
      });
      for (let i = prev.length; i < resultSheets.length; i++) {
        const s = resultSheets[i];
        next.push({
          sourceSheetId: s.sourceSheetId,
          material: s.material,
          thicknessMm: s.thicknessMm,
          widthMm: s.widthMm,
          lengthMm: s.lengthMm,
          history: [{ instances: s.instances.map(instToAssisted) }],
          historyIndex: 0,
        });
      }
      return next;
    });
    setDirty(true);
  }

  // ---- quantity accounting (GLOBAL across every sheet in the session) -----
  const placedQtyByPart = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const sess of sheetSessions) {
      for (const inst of sess.history[sess.historyIndex].instances) {
        m.set(inst.takeoffPartId, (m.get(inst.takeoffPartId) ?? 0) + 1);
      }
    }
    return m;
  }, [sheetSessions]);

  const requiredQtyByPart = React.useMemo(() => new Map(parts.map((p) => [p.takeoffPartId, p.requiredQty])), [parts]);

  // ---- committed polygons for collision testing (ACTIVE SHEET ONLY — spec §2 "All validation must use the active sheet's placements only") ----
  const committedPolygons = React.useMemo(() => {
    return instances
      .filter((inst) => inst.id !== replacingInstanceId)
      .map((inst) => {
        const part = partsById.get(inst.takeoffPartId);
        if (!part) return { instance: inst, polygon: [] as Point[] };
        const shape = computeOrientedShape(part.outer, inst.rotationDeg);
        return { instance: inst, polygon: translatePoints(shape.points, inst.xMm, inst.yMm) };
      });
  }, [instances, partsById, replacingInstanceId]);

  // ---- live ghost validation (placement) ----------------------------------
  // NOTE (Phase 2C): this used to "pin" the ghost to the last remembered
  // valid mouse position (lastValidGhostRef). That produced confusing
  // jump-back behavior and, worse, could stack a new part exactly on top
  // of one just committed. It has been replaced with a pure geometric
  // projection (findNearestValidOrigin): for any given raw cursor position
  // we compute, from scratch, the nearest position that keeps the part
  // fully inside the usable sheet area and at least partGapMm away from
  // every committed part. The result depends only on the CURRENT cursor
  // position/rotation and the CURRENT committed parts — never on history —
  // so it can't "remember" a stale, now-invalid spot.
  const committedBoxes = React.useMemo(
    () => committedPolygons.map((c) => computeBoundingBox(c.polygon)),
    [committedPolygons],
  );

  const ghost = React.useMemo(() => {
    if (!placing || !cursor || !selectedPartId) return null;
    const part = partsById.get(selectedPartId);
    if (!part) return null;
    // A part that has already reached its required quantity must never
    // show a ghost, even if some stale UI state still thinks it's "held".
    // Exception: while repositioning an already-placed instance
    // (replacingInstanceId set), that instance's own quantity slot is
    // "free" again — it's not counted twice (see committedPolygons above,
    // which already excludes it), so the quantity gate doesn't apply.
    if (!replacingInstanceId) {
      const requiredQty = requiredQtyByPart.get(selectedPartId) ?? 0;
      const placedQty = placedQtyByPart.get(selectedPartId) ?? 0;
      if (placedQty >= requiredQty) return null;
    }

    const shape = computeOrientedShape(part.outer, ghostRotation);
    // Cursor tracks the shape's own center for a natural feel.
    const rawOriginX = cursor.x - shape.width / 2;
    const rawOriginY = cursor.y - shape.height / 2;

    const projected = findNearestValidOrigin(
      rawOriginX,
      rawOriginY,
      shape.width,
      shape.height,
      bounds,
      committedBoxes,
      activeSheetConfig.partGapMm,
    );

    const polygon = translatePoints(shape.points, projected.x, projected.y);

    // Exact (non-bbox) re-check for the actual invalid-state indicator
    // shown to the user and used to gate the click. The projection above
    // is a bounding-box approximation (matches how the automatic engine
    // itself packs parts); this final check uses the real outline and the
    // real per-part gap distance, so it's the source of truth for whether
    // a click may commit here.
    let reason: InvalidReason = null;
    if (!projected.fits || !boundsContain(polygon, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)) {
      reason = "CROSSES_MARGIN";
    } else {
      for (let i = 0; i < committedPolygons.length; i++) {
        const c = committedPolygons[i];
        if (polygonsOverlap(polygon, c.polygon)) {
          reason = "OVERLAPS_EXISTING_PART";
          break;
        }
        if (activeSheetConfig.partGapMm > 0) {
          const box = committedBoxes[i];
          const ex = {
            minX: box.minX - activeSheetConfig.partGapMm,
            minY: box.minY - activeSheetConfig.partGapMm,
            maxX: box.maxX + activeSheetConfig.partGapMm,
            maxY: box.maxY + activeSheetConfig.partGapMm,
          };
          const pBox = computeBoundingBox(polygon);
          const collides = pBox.minX < ex.maxX && pBox.maxX > ex.minX && pBox.minY < ex.maxY && pBox.maxY > ex.minY;
          if (collides) {
            reason = "OVERLAPS_EXISTING_PART";
            break;
          }
        }
      }
    }

    return { polygon, xMm: projected.x, yMm: projected.y, rotationDeg: ghostRotation, reason, part };
  }, [placing, cursor, selectedPartId, ghostRotation, partsById, bounds, committedPolygons, committedBoxes, activeSheetConfig.partGapMm, replacingInstanceId, requiredQtyByPart, placedQtyByPart]);

  // ---- pattern detection ---------------------------------------------------
  const patternInstances: PatternPlacedInstance[] = React.useMemo(
    () =>
      instances
        .filter((i) => i.origin === "MANUAL")
        .map((i) => {
          const part = partsById.get(i.takeoffPartId)!;
          return {
            takeoffPartId: i.takeoffPartId,
            outer: part.outer,
            areaSqm: part.areaSqm,
            instanceNumber: i.instanceNumber,
            xMm: i.xMm,
            yMm: i.yMm,
            rotationDeg: i.rotationDeg,
            locked: i.locked,
          };
        }),
    [instances, partsById],
  );

  const pattern: DetectedPattern | null = React.useMemo(() => detectPattern(patternInstances), [patternInstances]);

  // ---- mouse handlers --------------------------------------------------
  function svgPointFromEvent(e: React.MouseEvent<SVGSVGElement>): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const padding = Math.max(activeSheetConfig.widthMm, activeSheetConfig.lengthMm) * 0.03;
    const viewW = activeSheetConfig.lengthMm + padding * 2;
    const viewH = activeSheetConfig.widthMm + padding * 2;
    const scaleX = viewW / rect.width;
    const scaleY = viewH / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX - padding;
    const svgYFromTop = (e.clientY - rect.top) * scaleY;
    // Flip vertically: SVG grows downward, sheet coordinates grow upward.
    const svgY = viewH - svgYFromTop - padding;
    return { x: svgX, y: svgY };
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!placing) return;
    const p = svgPointFromEvent(e);
    if (p) setCursor(p);
  }

  function handleClick() {
    if (!placing || !ghost || ghost.reason || !selectedPartId) return;
    const part = partsById.get(selectedPartId);
    if (!part) return;

    // Replacement mode: update the SAME instance in place instead of
    // creating a new one. Quantity is unaffected (we're moving an
    // existing instance, not adding one), so the requiredQty guard below
    // does not apply here.
    if (replacingInstanceId) {
      const updated = instances.map((inst) =>
        inst.id === replacingInstanceId
          ? { ...inst, xMm: ghost.xMm, yMm: ghost.yMm, rotationDeg: ghost.rotationDeg }
          : inst,
      );
      commitHistory(updated);
      setReplacingInstanceId(null);
      setPlacing(false);
      setCursor(null);
      return;
    }

    // Commit-layer quantity guard (spec: "never allow placedQty >
    // requiredQty" even with stale UI state) — re-checked here
    // independently of the ghost memo above.
    const requiredQty = requiredQtyByPart.get(selectedPartId) ?? 0;
    const placedQtyNow = placedQtyByPart.get(selectedPartId) ?? 0;
    if (placedQtyNow >= requiredQty) return;

    const nextInstanceNumber = placedQtyNow + 1;
    const newInstance: AssistedInstance = {
      id: nextId("inst"),
      takeoffPartId: selectedPartId,
      instanceNumber: nextInstanceNumber,
      xMm: ghost.xMm,
      yMm: ghost.yMm,
      rotationDeg: ghost.rotationDeg,
      locked: true,
      origin: "MANUAL",
    };
    commitHistory([...instances, newInstance]);

    // Auto-release: the instance we just committed may have completed
    // this part's required quantity. Check against the up-to-date count
    // (placedQtyNow + 1) rather than the stale `placedQtyByPart` memo,
    // which hasn't re-derived from `instances` yet on this same tick.
    if (nextInstanceNumber >= requiredQty) {
      setPlacing(false);
      setCursor(null);
      setSelectedPartId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.key === "Escape") {
      // Cancel a replacement-in-progress: since the original instance was
      // never mutated (only excluded from the collision set/render list
      // while its ghost was shown), simply clearing this restores its
      // exact original position, rotation, and metadata — no explicit
      // "undo" needed.
      setReplacingInstanceId(null);
      setPlacing(false);
      setCursor(null);
    } else if (e.key.toLowerCase() === "r") {
      setGhostRotation((r) => {
        const delta = e.shiftKey ? -rotationStepDeg : rotationStepDeg;
        const next = (r + delta) % 360;
        return next < 0 ? next + 360 : next;
      });
    }
  }

  function deleteInstance(id: string) {
    commitHistory(instances.filter((i) => i.id !== id));
    if (selectedInstanceId === id) setSelectedInstanceId(null);
    if (replacingInstanceId === id) {
      // The instance being repositioned was deleted out from under the
      // replacement — cancel the in-progress ghost cleanly.
      setReplacingInstanceId(null);
      setPlacing(false);
      setCursor(null);
    }
  }

  // ---- pattern application ---------------------------------------------
  const [patternResult, setPatternResult] = React.useState<{
    generated: AssistedInstance[];
    fullyApplied: boolean;
    shortfallCycles: number;
  } | null>(null);

  function previewPattern() {
    if (!pattern) return;
    const existing: PatternPlacedInstance[] = patternInstances;
    const result = expandPatternOnSheet(pattern, existing, bounds, {
      requiredQtyByPart,
      placedQtyByPart,
      partGapMm: sheetConfig.partGapMm,
    });
    setPatternResult({
      generated: result.generated.map((g) => ({
        id: nextId("pattern"),
        takeoffPartId: g.takeoffPartId,
        instanceNumber: g.instanceNumber,
        xMm: g.xMm,
        yMm: g.yMm,
        rotationDeg: g.rotationDeg,
        locked: false,
        origin: "PATTERN",
      })),
      fullyApplied: result.fullyApplied,
      shortfallCycles: result.shortfallCycles,
    });
  }

  function applyPattern() {
    if (!patternResult) return;
    const finalInstances = [...instances, ...patternResult.generated];
    commitHistory(finalInstances);
    setPatternResult(null);

    // If every part is now at its required quantity, release any
    // currently-held part — there's nothing left it could validly place.
    const finalPlacedByPart = new Map<string, number>();
    for (const inst of finalInstances) {
      finalPlacedByPart.set(inst.takeoffPartId, (finalPlacedByPart.get(inst.takeoffPartId) ?? 0) + 1);
    }
    const allComplete = parts.every((p) => (finalPlacedByPart.get(p.takeoffPartId) ?? 0) >= p.requiredQty);
    if (allComplete || (selectedPartId && (finalPlacedByPart.get(selectedPartId) ?? 0) >= (requiredQtyByPart.get(selectedPartId) ?? 0))) {
      setPlacing(false);
      setCursor(null);
      setSelectedPartId(null);
      setReplacingInstanceId(null);
    }
  }

  function clearPatternPreview() {
    setPatternResult(null);
  }

  function clearAll() {
    commitHistory([]);
    setPatternResult(null);
    setReplacingInstanceId(null);
    setPlacing(false);
  }

  function resetPattern() {
    // Spec §21: Reset Pattern only clears detected-pattern UI state, it
    // never deletes manually placed parts. Since detection is purely
    // derived (useMemo over `instances`), "resetting" it just means
    // discarding any pending pattern PREVIEW — the detector will simply
    // re-detect from the same manual instances on the next render, which
    // is the correct/expected behavior (the user can still re-approve it).
    setPatternResult(null);
  }

  // ---- part catalog for the session/optimizer/export modules --------------
  const partCatalog = React.useMemo(() => {
    const m = new Map<string, SessionPartCatalogEntry>();
    for (const p of parts) {
      m.set(p.takeoffPartId, { takeoffPartId: p.takeoffPartId, itemNo: p.itemNo, outer: p.outer, areaSqm: p.areaSqm, requiredQty: p.requiredQty });
    }
    return m;
  }, [parts]);

  const engineConfig = React.useMemo(
    () => ({
      marginLeftMm: sheetConfig.marginLeftMm,
      marginRightMm: sheetConfig.marginRightMm,
      marginTopMm: sheetConfig.marginTopMm,
      marginBottomMm: sheetConfig.marginBottomMm,
      partGapMm: sheetConfig.partGapMm,
    }),
    [sheetConfig],
  );

  const effectiveCandidateSources: EngineSourceInput[] = React.useMemo(
    () =>
      candidateSources && candidateSources.length > 0
        ? candidateSources
        : [{ sourceSheetId: sheetIdentity.sourceSheetId, material: sheetIdentity.material, thicknessMm: sheetIdentity.thicknessMm, widthMm: sheetConfig.widthMm, lengthMm: sheetConfig.lengthMm }],
    [candidateSources, sheetIdentity, sheetConfig],
  );

  function toSessionForSheet(sheetIndex: number): AssistedSheetSession {
    const sess = sheetSessions[sheetIndex];
    const instanceList = sess.history[sess.historyIndex].instances;
    return {
      sourceSheetId: sess.sourceSheetId,
      material: sess.material,
      thicknessMm: sess.thicknessMm,
      widthMm: sess.widthMm,
      lengthMm: sess.lengthMm,
      instances: instanceList.map((i) => ({
        instanceKey: i.id,
        takeoffPartId: i.takeoffPartId,
        outer: partsById.get(i.takeoffPartId)?.outer ?? [],
        areaSqm: partsById.get(i.takeoffPartId)?.areaSqm ?? 0,
        instanceNumber: i.instanceNumber,
        xMm: i.xMm,
        yMm: i.yMm,
        rotationDeg: i.rotationDeg,
        locked: i.locked,
        origin: i.origin,
      })),
    };
  }

  const allSessions = React.useMemo(() => sheetSessions.map((_, i) => toSessionForSheet(i)), [sheetSessions, partsById]);

  const [patternPreference, setPatternPreference] = React.useState<PatternPreference>("FLEXIBLE");
  const [optimizing, setOptimizing] = React.useState(false);

  function runOptimizeRemaining() {
    setOptimizing(true);
    try {
      const result = optimizeRemainingWithPreference(allSessions, partCatalog, effectiveCandidateSources, engineConfig, patternPreference, {
        rotationStepDeg,
      });
      applyMultiSheetResult(result.sheets);

      if (result.fullyPlaced) {
        toast.success(
          `Optimized (${patternPreference.toLowerCase()}): ${result.newlyPlacedCount} part(s) added${result.openedNewSheets > 0 ? `, ${result.openedNewSheets} new sheet(s) opened` : ""}${result.kept === "REBUILT" ? ", layout improved" : ""}.`,
        );
      } else {
        const shortfallList = [...result.stillShortByPart.entries()]
          .map(([partId, qty]) => `#${partCatalog.get(partId)?.itemNo ?? partId} × ${qty}`)
          .join(", ");
        toast.warning(`Optimized as much as possible — still short: ${shortfallList}`);
      }
    } finally {
      setOptimizing(false);
    }
  }

  const [confirmOptimizeEntire, setConfirmOptimizeEntire] = React.useState(false);

  function runOptimizeEntireNest() {
    setOptimizing(true);
    try {
      // Spec §10/§11: the only action allowed to move MANUAL placements —
      // always uses the FULL multi-strategy optimizer (the same one the
      // automatic "Run Nesting" flow uses) rebuilt from scratch, and only
      // replaces the session if the rebuild is both valid and at least as
      // good by scoreSheets() (never accepts a worse result).
      const result = optimizeEntireSessionWithFullOptimizer(allSessions, partCatalog, effectiveCandidateSources, engineConfig, { rotationStepDeg });
      applyMultiSheetResult(result.sheets);
      setPatternResult(null);
      setConfirmOptimizeEntire(false);
      toast.success(
        result.kept === "REBUILT"
          ? `Entire nest re-optimized: ${result.totalPlacedAfter} part(s) placed across ${result.sheets.length} sheet(s).`
          : "Current nesting is already better than the optimized candidate — nothing was changed.",
      );
    } finally {
      setOptimizing(false);
    }
  }

  // ---- export ----------------------------------------------------------
  function downloadText(fileName: string, content: string) {
    const blob = new Blob([content], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadSheetDxf(session: AssistedSheetSession, sheetNumber: number) {
    const placements = session.instances.map((inst) => {
      const part = partsById.get(inst.takeoffPartId);
      return {
        takeoffPartId: inst.takeoffPartId,
        itemNo: part?.itemNo ?? 0,
        instanceNumber: inst.instanceNumber,
        xMm: inst.xMm,
        yMm: inst.yMm,
        rotationDeg: inst.rotationDeg,
        outer: part?.outer ?? [],
        holes: part?.holes ?? [],
      };
    });
    const content = writeNestingSheetDxf({
      runId: sheetIdentity.sourceSheetId,
      sheetNumber,
      widthMm: session.widthMm,
      lengthMm: session.lengthMm,
      marginLeftMm: sheetConfig.marginLeftMm,
      marginRightMm: sheetConfig.marginRightMm,
      marginTopMm: sheetConfig.marginTopMm,
      marginBottomMm: sheetConfig.marginBottomMm,
      placements,
    });
    downloadText(nestingSheetDxfFileName(sheetIdentity.sourceSheetId, sheetNumber), content);
  }

  function handleDownloadDxf() {
    const { valid, issues } = validateSessionForExport(allSessions, partCatalog, engineConfig);
    const blocking = issues.filter((i) => i.kind !== "QUANTITY_SHORTFALL");
    if (!valid && blocking.length > 0) {
      toast.error(`Cannot export this nest yet — ${blocking.length} geometry issue(s): ${blocking[0].message}`);
      return;
    }
    allSessions.forEach((session, idx) => downloadSheetDxf(session, idx + 1));
    if (issues.some((i) => i.kind === "QUANTITY_SHORTFALL")) {
      toast.warning("Exported a partial nest — some required quantities are not yet met.");
    }
  }

  // ---- save / finish -----------------------------------------------------
  const [saving, setSaving] = React.useState(false);
  const [savedRunId, setSavedRunId] = React.useState<string | null>(initialRunId ?? null);

  async function handleFinish() {
    // Nothing changed since load/last save — nothing to persist (spec §8
    // "If unchanged, Finish Assisted Nesting can simply return to the
    // saved result").
    if (initialSheets && !dirty) {
      onFinish?.(instances);
      toast.info("No changes to save.");
      return;
    }

    const { valid, issues } = validateSessionForExport(allSessions, partCatalog, engineConfig);
    const blocking = issues.filter((i) => i.kind !== "QUANTITY_SHORTFALL");
    if (!valid && blocking.length > 0) {
      toast.error(`Cannot finish nesting. Please fix the highlighted placement issue: ${blocking[0].message}`);
      return;
    }

    if (!jobId) {
      // No job to persist against — keep the previous in-memory-only
      // behavior rather than silently pretending to save.
      onFinish?.(instances);
      toast.info("This session isn't attached to a nesting job, so it wasn't saved — use Download DXF to keep your result.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/nesting/jobs/${jobId}/assisted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: parts.map((p) => ({ takeoffPartId: p.takeoffPartId, itemNo: p.itemNo, outer: p.outer, areaSqm: p.areaSqm, requiredQty: p.requiredQty })),
          sheets: allSessions.map((s) => ({
            sourceSheetId: s.sourceSheetId,
            material: s.material,
            thicknessMm: s.thicknessMm,
            widthMm: s.widthMm,
            lengthMm: s.lengthMm,
            instances: s.instances.map((i) => ({
              instanceKey: i.instanceKey,
              takeoffPartId: i.takeoffPartId,
              instanceNumber: i.instanceNumber,
              xMm: i.xMm,
              yMm: i.yMm,
              rotationDeg: i.rotationDeg,
              locked: i.locked,
              origin: i.origin,
            })),
          })),
          config: engineConfig,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (HTTP ${res.status})`);
      }

      const saved = await res.json();
      setSavedRunId(saved.id ?? null);
      setDirty(false);
      toast.success("Assisted nesting saved successfully.");
      onFinish?.(instances);
    } catch (err) {
      // Never show success on failure, and never discard the in-memory
      // session — the user's placements are still right here in state.
      toast.error(`Could not save the assisted nesting. Your current work is still preserved. ${err instanceof Error ? err.message : "Try again."}`);
    } finally {
      setSaving(false);
    }
  }

  // ---- render ------------------------------------------------------------
  const padding = Math.max(activeSheetConfig.widthMm, activeSheetConfig.lengthMm) * 0.03;
  const viewW = activeSheetConfig.lengthMm + padding * 2;
  const viewH = activeSheetConfig.widthMm + padding * 2;
  const strokeW = Math.max(activeSheetConfig.widthMm, activeSheetConfig.lengthMm) * 0.003;

  const selectedPart = selectedPartId ? partsById.get(selectedPartId) : null;
  const requiredForSelected = selectedPartId ? (requiredQtyByPart.get(selectedPartId) ?? 0) : 0;
  const placedForSelected = selectedPartId ? (placedQtyByPart.get(selectedPartId) ?? 0) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Assisted Nesting</h3>
          <span className="text-xs text-muted-foreground">
            Select a part, place two instances with your desired pattern, then let the engine finish the job.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={undo} disabled={activeSheet.historyIndex === 0}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={activeSheet.historyIndex >= activeSheet.history.length - 1}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={instances.length === 0}>
            <Trash2 className="mr-1 h-4 w-4" /> Clear Pattern
          </Button>
          {onExit && (
            <Button variant="ghost" size="sm" onClick={onExit}>
              <X className="mr-1 h-4 w-4" /> Exit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr_260px] gap-3">
        {/* Parts queue */}
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Parts Queue</div>
          {parts.map((p) => {
            const placedQty = placedQtyByPart.get(p.takeoffPartId) ?? 0;
            const remaining = Math.max(0, p.requiredQty - placedQty);
            const done = remaining === 0;
            return (
              <button
                key={p.takeoffPartId}
                onClick={() => {
                  setSelectedPartId(p.takeoffPartId);
                  setPlacing(false);
                  setReplacingInstanceId(null);
                }}
                className={`flex flex-col rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                  selectedPartId === p.takeoffPartId ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"
                }`}
              >
                <span className="font-medium">
                  #{p.itemNo} {done && <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-600" />}
                </span>
                <span className="text-muted-foreground">
                  Placed {placedQty} / {p.requiredQty} · Remaining {remaining}
                </span>
              </button>
            );
          })}

          {selectedPart && (
            <div className="mt-2 border-t border-border pt-2">
              <div className="text-xs text-muted-foreground">
                Selected: #{selectedPart.itemNo} — {placedForSelected}/{requiredForSelected} placed
              </div>
              <Button
                size="sm"
                className="mt-2 w-full"
                disabled={placedForSelected >= requiredForSelected}
                onClick={() => {
                  setReplacingInstanceId(null);
                  setPlacing(true);
                  setGhostRotation(0);
                }}
              >
                Start Placing
              </Button>
            </div>
          )}

          {/* Part selection list (spec: shown directly below "Start
              Placing"). Mirrors the Parts Queue above but is the primary
              live-updating list of what can still be manually placed —
              required/placed/remaining per part, click to select, and
              completed parts are disabled so they can't be reselected for
              another placement. */}
          <div className="mt-3 border-t border-border pt-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Parts</div>
            <div className="flex flex-col gap-1">
              {parts.map((p) => {
                const placedQty = placedQtyByPart.get(p.takeoffPartId) ?? 0;
                const requiredQty = p.requiredQty;
                const remaining = Math.max(0, requiredQty - placedQty);
                const complete = remaining === 0;
                return (
                  <button
                    key={p.takeoffPartId}
                    disabled={complete}
                    onClick={() => {
                      if (complete) return;
                      setReplacingInstanceId(null);
                      setSelectedPartId(p.takeoffPartId);
                      setPlacing(true);
                      setGhostRotation(0);
                    }}
                    className={`flex flex-col rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                      complete
                        ? "cursor-not-allowed border-transparent opacity-60"
                        : selectedPartId === p.takeoffPartId
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:bg-muted"
                    }`}
                  >
                    <span className="flex items-center justify-between font-medium">
                      <span>
                        #{p.itemNo}
                        {p.description ? ` · ${p.description}` : ""}
                      </span>
                      {complete && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                    </span>
                    <span className={complete ? "text-emerald-600" : "text-muted-foreground"}>
                      {complete ? "Complete" : `${placedQty} / ${requiredQty} placed · Remaining ${remaining}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative">
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            {sheetSessions.map((s, idx) => {
              const insts = s.history[s.historyIndex].instances;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setActiveSheetIndex(idx);
                    setPlacing(false);
                    setSelectedInstanceId(null);
                    setReplacingInstanceId(null);
                  }}
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    activeSheetIndex === idx ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Sheet {idx + 1} · {s.widthMm}×{s.lengthMm}mm · {s.material} {s.thicknessMm}mm · {insts.length} placed
                </button>
              );
            })}
            <button
              onClick={addSheet}
              className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              title={`Add another ${sheetIdentity.material} ${sheetIdentity.thicknessMm}mm sheet (${sheetConfig.widthMm}×${sheetConfig.lengthMm}mm)`}
            >
              + Sheet
            </button>
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${viewW} ${viewH}`}
            className="w-full cursor-crosshair rounded-md border border-border bg-white outline-none"
            style={{ aspectRatio: `${viewW} / ${viewH}` }}
            tabIndex={0}
            onMouseMove={handleMouseMove}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
          >
            <g transform={`translate(${padding}, ${viewH - padding}) scale(1, -1)`}>
              {/* sheet */}
              <rect x={0} y={0} width={activeSheetConfig.lengthMm} height={activeSheetConfig.widthMm} fill="#f8fafc" stroke="#94a3b8" strokeWidth={strokeW} />
              {/* usable/margin boundary */}
              <rect
                x={bounds.minX}
                y={bounds.minY}
                width={bounds.maxX - bounds.minX}
                height={bounds.maxY - bounds.minY}
                fill="none"
                stroke="#f97316"
                strokeDasharray={`${strokeW * 3} ${strokeW * 2}`}
                strokeWidth={strokeW}
              />

              {/* committed placements */}
              {committedPolygons.map(({ instance, polygon }) => {
                const part = partsById.get(instance.takeoffPartId);
                const isPatternPreview = instance.origin === "PATTERN";
                return (
                  <g
                    key={instance.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedInstanceId(instance.id); }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      // Double-click-to-replace (spec §2): hold this exact
                      // instance for repositioning. Native SVG hit-testing
                      // on the <path> below already resolves to the
                      // correct instance even when bounding boxes
                      // visually overlap, since it tests the real filled
                      // polygon area, not a box.
                      setReplacingInstanceId(instance.id);
                      setSelectedPartId(instance.takeoffPartId);
                      setGhostRotation(instance.rotationDeg);
                      setSelectedInstanceId(instance.id);
                      setPlacing(true);
                    }}
                    className="cursor-pointer"
                  >
                    <path
                      d={pointsToPath(polygon)}
                      fill={isPatternPreview ? "#16a34a" : "#2563eb"}
                      fillOpacity={selectedInstanceId === instance.id ? 0.32 : 0.18}
                      stroke={isPatternPreview ? "#16a34a" : "#2563eb"}
                      strokeWidth={strokeW}
                    >
                      <title>{`#${part?.itemNo ?? "?"} — rotation ${instance.rotationDeg}°${instance.locked ? " (locked)" : ""} — double-click to reposition`}</title>
                    </path>
                  </g>
                );
              })}

              {/* pattern preview (proposed, not yet committed) */}
              {patternResult?.generated.map((g) => {
                const part = partsById.get(g.takeoffPartId);
                if (!part) return null;
                const shape = computeOrientedShape(part.outer, g.rotationDeg);
                const polygon = translatePoints(shape.points, g.xMm, g.yMm);
                return (
                  <path
                    key={g.id}
                    d={pointsToPath(polygon)}
                    fill="#a855f7"
                    fillOpacity={0.15}
                    stroke="#a855f7"
                    strokeDasharray={`${strokeW * 2} ${strokeW}`}
                    strokeWidth={strokeW}
                  />
                );
              })}

              {/* ghost (live placement preview) */}
              {ghost && (
                <path
                  d={pointsToPath(ghost.polygon)}
                  fill={ghost.reason ? "#ef4444" : "#22c55e"}
                  fillOpacity={0.25}
                  stroke={ghost.reason ? "#ef4444" : "#22c55e"}
                  strokeWidth={strokeW}
                />
              )}
            </g>
          </svg>

          {placing && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow">
              <div>Rotation: {ghostRotation}°</div>
              {ghost?.reason ? (
                <div className="flex items-center gap-1 text-red-600">
                  <AlertTriangle className="h-3 w-3" />
                  {ghost.reason === "OVERLAPS_EXISTING_PART" ? "Overlaps another part" : "Crosses the usable sheet margin"}
                </div>
              ) : (
                <div className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" /> Valid placement
                </div>
              )}
              <div className="mt-1 text-muted-foreground">Scroll to rotate · Click to place · Esc to cancel</div>
            </div>
          )}
        </div>

        {/* Pattern panel */}
        <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-xs">
          <div className="font-medium text-muted-foreground">Pattern</div>
          {!pattern && <div className="text-muted-foreground">Place at least two compatible instances to detect a repeating pattern.</div>}
          {pattern && (
            <>
              <div className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Detected — {pattern.slots.length}-part repeating pattern
              </div>
              <div className="flex flex-col gap-0.5">
                {pattern.slots.map((s, i) => {
                  const part = partsById.get(s.takeoffPartId);
                  return (
                    <div key={i} className="text-muted-foreground">
                      #{part?.itemNo ?? "?"} → {s.rotationDeg.toFixed(0)}°
                    </div>
                  );
                })}
              </div>

              {!patternResult ? (
                <div className="mt-1 flex gap-2">
                  <Button size="sm" onClick={previewPattern}>
                    <Wand2 className="mr-1 h-3.5 w-3.5" /> Use This Pattern
                  </Button>
                  <Button size="sm" variant="ghost" onClick={resetPattern}>
                    Reset Pattern
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  <div className={patternResult.fullyApplied ? "text-emerald-600" : "text-amber-600"}>
                    {patternResult.fullyApplied
                      ? `Pattern applies cleanly — ${patternResult.generated.length} parts will be added.`
                      : `Pattern could be applied to ${patternResult.generated.length} of the remaining parts. ${patternResult.shortfallCycles} more repetition(s) would cross the sheet boundary or collide.`}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={applyPattern}>
                      Apply Pattern
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearPatternPreview}>
                      Keep Editing
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-3 border-t border-border pt-2 font-medium text-muted-foreground">Optimization</div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Pattern Preference
              <select
                className="h-6 rounded border border-input bg-background px-1 text-[11px]"
                value={patternPreference}
                onChange={(e) => setPatternPreference(e.target.value as PatternPreference)}
                disabled={optimizing}
              >
                <option value="STRICT">Strict — keep everything fixed</option>
                <option value="FLEXIBLE">Flexible — may adjust pattern parts</option>
                <option value="OPTIMIZE">Optimize — strong candidate only</option>
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={runOptimizeRemaining} disabled={optimizing}>
              <Sparkles className="mr-1 h-3.5 w-3.5" /> {optimizing ? "Optimizing nesting…" : "Optimize Remaining"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmOptimizeEntire(true)} disabled={instances.length === 0 || optimizing}>
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Optimize Entire Nest
            </Button>
            <span className="text-muted-foreground">
              &quot;Optimize Remaining&quot; fills empty space (respecting your Pattern Preference above). &quot;Optimize Entire Nest&quot; always rebuilds the whole sheet and may reposition manual placements.
            </span>
          </div>

          {sheetSessions.length > 1 && (
            <div className="mt-2 rounded-md bg-muted/50 p-1.5 text-muted-foreground">
              {sheetSessions.length} sheets in this session ({sheetSessions.reduce((s, sh) => s + sh.history[sh.historyIndex].instances.length, 0)} parts total). Use the sheet tabs above the canvas to switch between them — every sheet is fully editable.
            </div>
          )}

          <div className="mt-3 border-t border-border pt-2 font-medium text-muted-foreground">Placed Instances</div>
          <div className="flex max-h-64 flex-col gap-1 overflow-auto">
            {instances.map((inst) => {
              const part = partsById.get(inst.takeoffPartId);
              const originColor = inst.origin === "MANUAL" ? "text-blue-600" : inst.origin === "PATTERN" ? "text-emerald-600" : "text-purple-600";
              return (
                <div
                  key={inst.id}
                  className={`flex items-center justify-between rounded px-1.5 py-1 ${selectedInstanceId === inst.id ? "bg-primary/10" : ""}`}
                >
                  <span className="flex items-center gap-1">
                    {inst.locked && <Lock className="h-3 w-3 text-muted-foreground" />}#{part?.itemNo ?? "?"} · {inst.rotationDeg.toFixed(0)}°
                    <span className={`text-[10px] font-medium uppercase ${originColor}`}>{inst.origin}</span>
                  </span>
                  <button className="text-muted-foreground hover:text-red-600" onClick={() => deleteInstance(inst.id)}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            <Button size="sm" variant="outline" onClick={handleDownloadDxf}>
              <Download className="mr-1 h-3.5 w-3.5" /> Download DXF{sheetSessions.length > 1 ? " (all sheets)" : ""}
            </Button>
            {savedRunId && !dirty ? (
              <div className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved (run {savedRunId.slice(0, 8)}…)
              </div>
            ) : (
              <>
                {savedRunId && dirty && (
                  <div className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" /> You have unsaved changes.
                  </div>
                )}
                <Button size="sm" onClick={handleFinish} disabled={saving}>
                  {saving ? "Saving…" : savedRunId ? "Save Changes" : "Finish Assisted Nesting"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOptimizeEntire}
        onOpenChange={setConfirmOptimizeEntire}
        title="Optimize entire nest?"
        description="This may move manually placed parts and change the pattern you created. Your current assisted layout will be replaced with the optimizer's best result."
        confirmLabel="Optimize"
        onConfirm={runOptimizeEntireNest}
      />
    </div>
  );
}
