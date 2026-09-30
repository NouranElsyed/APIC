"use client";
import * as React from "react";
import { Check, Download, FileSpreadsheet, FolderInput, Layers, Loader2, Plus, RotateCcw, Save, Trash2, TriangleAlert, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTakeoffProject } from "@/features/takeoff/project-context";
import type { TakeoffDrawingRow } from "@/features/takeoff/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { nestKindOf } from "@/features/nesting/part-routing";
import { register2D } from "../report/report-store";
import type { Report2DInput } from "../report/report-2d";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cloneResult, SavedNestsCard, type SavedNest } from "./saved-nests";
import {
  addFileParts,
  buildDxf,
  cancelGroupDrag,
  cancelPick,
  drawSheet,
  inGhost,
  itemsInRect,
  leftOf,
  makeSettings,
  minSheetSize,
  moveGroup,
  moveTo,
  newSheet,
  nudgeGroup,
  parseDXF,
  partColor,
  path,
  placedCounts,
  problemMessages,
  resizeSheet,
  rotate,
  rotBox,
  runOptimize,
  sheetStats,
  startGroupDrag,
  startNew,
  startPick,
  syncUnplaced,
  transfer,
  type Counters,
  type Group,
  type Item,
  type MultiSel,
  type OptResult,
  type Pt,
  type Sel,
  type Settings,
  type Sheet,
} from "./engine";

const DEFAULT_MSG =
  "SolidWorks: export the flat pattern / drawing to DXF (File → Save As → DXF). .sldprt can't be read directly.";
const selectCls =
  "h-9 w-full rounded-lg border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function PartThumb({ g }: { g: Group }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 60, 40);
    const k = Math.min(56 / g.w, 36 / g.h);
    c.setTransform(k, 0, 0, -k, 2, 38);
    c.fillStyle = partColor(g);
    c.fill(path(g, 0, 0, 0), "evenodd");
  }, [g]);
  return <canvas ref={ref} width={60} height={40} />;
}

/** Small picture of the part that follows the cursor while it is held but not over a sheet yet. */
function GhostPart({ selRef, version, init }: { selRef: React.MutableRefObject<Sel | null>; version: number; init: { x: number; y: number } }) {
  const box = React.useRef<HTMLDivElement>(null);
  const cv = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const put = (x: number, y: number) => {
      el.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    };
    put(init.x, init.y);
    const mv = (e: PointerEvent) => put(e.clientX, e.clientY);
    window.addEventListener("pointermove", mv);
    return () => window.removeEventListener("pointermove", mv);
  }, [init]);
  React.useEffect(() => {
    const c = cv.current?.getContext("2d");
    const it = selRef.current?.it;
    if (!cv.current || !c || !it) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 96, 72);
    const rb = rotBox(it.g, it.rot);
    const k = Math.min(90 / rb.w, 66 / rb.h);
    c.setTransform(k, 0, 0, -k, 3, 69);
    c.globalAlpha = 0.85;
    c.fillStyle = partColor(it.g);
    c.fill(path(it.g, it.rot, 0, 0), "evenodd");
  }, [selRef, version]);
  return (
    <div ref={box} className="pointer-events-none fixed left-0 top-0 z-50 rounded border border-primary/50 bg-card/80 shadow-lg">
      <canvas ref={cv} width={96} height={72} />
    </div>
  );
}

interface SheetCanvasProps {
  sheet: Sheet;
  index: number;
  S: Settings;
  width: number;
  selRef: React.MutableRefObject<Sel | null>;
  version: number;
  /** Index of the sheet the picked-up part is currently over (null = nothing held). */
  heldIdx: number | null;
  /** True while the mouse button is still down after pressing a part in the list (press-hold-drop). */
  dragRef: React.MutableRefObject<boolean>;
  /** Parts selected with a selection box (CAD style); they are moved together. */
  multiRef: React.MutableRefObject<MultiSel | null>;
  /** Lets touch screens use the selection box too (a finger drag normally scrolls the page). */
  selectMode: boolean;
  onChange: () => void;
}

type Gesture =
  | { kind: "box"; start: Pt; add: boolean; sx: number; sy: number }
  | { kind: "move"; sx: number; sy: number };

function SheetCanvas({ sheet, index, S, width, selRef, version, heldIdx, dragRef, multiRef, selectMode, onChange }: SheetCanvasProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const k = width / S.W;
  const h = Math.ceil(S.H * k);
  const holdingHere = heldIdx === index;
  const raf = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const boxRef = React.useRef<{ x0: number; y0: number; x1: number; y1: number; cross: boolean } | null>(null);
  const gesture = React.useRef<Gesture | null>(null);

  const paint = React.useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const ms = multiRef.current;
    drawSheet(sheet, cv, k, S, selRef.current?.it ?? null, !!selRef.current?.bad, {
      sel: ms && ms.sh === sheet ? new Set(ms.items) : null,
      box: boxRef.current,
    });
  }, [sheet, k, S, selRef, multiRef]);

  React.useEffect(() => {
    paint();
  }, [paint, h, version]);

  // Esc while drawing a selection box cancels the box
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || gesture.current?.kind !== "box") return;
      gesture.current = null;
      boxRef.current = null;
      paint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paint]);

  // wheel must be a non-passive native listener so it can preventDefault()
  React.useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      const s = selRef.current;
      if (!s) return;
      e.preventDefault();
      const t = performance.now();
      if (t - (s.lw || 0) < 30) return;
      s.lw = t;
      // free rotation: 5° per notch, hold Shift for 1° fine steps (Shift+wheel may arrive as deltaX)
      const dy = e.deltaY || e.deltaX;
      rotate(s, S, (dy > 0 ? 1 : -1) * (e.shiftKey ? 1 : 5));
      onChange();
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [S, selRef, onChange]);

  const mm = (e: { clientX: number; clientY: number }): Pt => {
    const cv = ref.current as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) * cv.width) / r.width;
    const py = ((e.clientY - r.top) * cv.height) / r.height;
    return [px / k, (cv.height - py) / k];
  };

  /** Top-most part under the point (mm), or null. */
  const partAt = (m: Pt): Item | null => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return null;
    c.setTransform(k, 0, 0, -k, 0, cv.height);
    for (let j = sheet.items.length - 1; j >= 0; j--) {
      const it = sheet.items[j];
      if (c.isPointInPath(path(it.g, it.rot, it.x, it.y), m[0] * k, cv.height - m[1] * k, "evenodd")) return it;
    }
    return null;
  };

  const endGesture = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const gs = gesture.current;
    if (!gs) return false;
    gesture.current = null;
    ref.current?.releasePointerCapture?.(e.pointerId);
    if (gs.kind === "move") {
      const ms = multiRef.current;
      if (ms) {
        if (cancelled) cancelGroupDrag(ms);
        ms.drag = undefined;
      }
      onChange();
      return true;
    }
    boxRef.current = null;
    if (cancelled) {
      paint();
      return true;
    }
    const m = mm(e);
    const dragged = Math.hypot(e.clientX - gs.sx, e.clientY - gs.sy) >= 4;
    const prev = multiRef.current;
    if (!dragged) {
      if (!gs.add) multiRef.current = null; // a plain click on empty space clears the selection
    } else {
      // left → right = window (fully inside only), right → left = crossing (anything touched)
      const found = itemsInRect(sheet, [gs.start[0], gs.start[1], m[0], m[1]], m[0] < gs.start[0]);
      const keep = gs.add && prev && prev.sh === sheet ? prev.items : [];
      const items = Array.from(new Set([...keep, ...found]));
      multiRef.current = items.length ? { sh: sheet, idx: index, items } : null;
    }
    onChange();
    return true;
  };

  return (
    <canvas
      ref={ref}
      width={width}
      height={h}
      data-sheet-index={index}
      className="w-full select-none rounded border border-border bg-card"
      style={{ touchAction: holdingHere || selectMode ? "none" : "auto", cursor: heldIdx !== null ? "move" : "default" }}
      onPointerDown={(e) => {
        // nothing held: press on a part = select it and drag (moves the whole selection); press on empty space = selection box
        if (e.button !== 0 || selRef.current || dragRef.current || multiRef.current?.carry) return;
        if (e.pointerType === "touch" && !selectMode) return;
        const m = mm(e);
        const it = partAt(m);
        const cur = multiRef.current && multiRef.current.sh === sheet ? multiRef.current : null;
        if (it) {
          if (e.shiftKey) {
            // Shift+click adds / removes one part without moving anything
            const items = cur ? (cur.items.includes(it) ? cur.items.filter((x) => x !== it) : [...cur.items, it]) : [it];
            multiRef.current = items.length ? { sh: sheet, idx: index, items } : null;
            onChange();
            return;
          }
          if (!cur || !cur.items.includes(it)) multiRef.current = { sh: sheet, idx: index, items: [it] };
          const ms = multiRef.current as MultiSel;
          startGroupDrag(ms, S, m);
          gesture.current = { kind: "move", sx: e.clientX, sy: e.clientY };
        } else {
          gesture.current = { kind: "box", start: m, add: e.shiftKey, sx: e.clientX, sy: e.clientY };
          boxRef.current = { x0: m[0], y0: m[1], x1: m[0], y1: m[1], cross: false };
        }
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onChange();
      }}
      onPointerCancel={(e) => {
        endGesture(e, true);
      }}
      onPointerUp={(e) => {
        if (endGesture(e, false)) return;
        // press on a part in the list, keep the button down, release over the sheet = drop it here
        const s = selRef.current;
        if (!dragRef.current || !s || !s.fresh || s.idx !== index || s.bad) return;
        dragRef.current = false;
        selRef.current = null;
        onChange();
      }}
      onDoubleClick={(e) => {
        const cv = ref.current;
        const c = cv?.getContext("2d");
        if (!cv || !c) return;
        const m = mm(e);
        c.setTransform(k, 0, 0, -k, 0, cv.height);
        for (let j = sheet.items.length - 1; j >= 0; j--) {
          const it = sheet.items[j];
          if (c.isPointInPath(path(it.g, it.rot, it.x, it.y), m[0] * k, cv.height - m[1] * k, "evenodd")) {
            const ms = multiRef.current;
            if (ms && ms.sh === sheet && ms.items.length > 1 && ms.items.includes(it)) {
              // double-click on a selected part with several selected: pick up ALL of them together
              gesture.current = null;
              ms.carry = true;
              startGroupDrag(ms, S, m);
              onChange();
              return;
            }
            multiRef.current = null; // one part in hand replaces any box selection
            selRef.current = startPick(sheet, index, it, m);
            onChange();
            return;
          }
        }
      }}
      onPointerMove={(e) => {
        const gs = gesture.current;
        if (gs) {
          const m = mm(e);
          if (gs.kind === "box") {
            boxRef.current = { x0: gs.start[0], y0: gs.start[1], x1: m[0], y1: m[1], cross: m[0] < gs.start[0] };
            paint(); // rubber band only: no need to re-render the page
          } else {
            const ms = multiRef.current;
            if (ms?.drag) {
              moveGroup(ms, S, m[0] - ms.drag.pm[0], m[1] - ms.drag.pm[1]);
              if (!raf.current) {
                raf.current = requestAnimationFrame(() => {
                  raf.current = 0;
                  onChange();
                });
              }
            }
          }
          return;
        }
        const cm = multiRef.current;
        if (cm?.carry && cm.drag && cm.sh === sheet) {
          const m = mm(e);
          moveGroup(cm, S, m[0] - cm.drag.pm[0], m[1] - cm.drag.pm[1]);
          if (!raf.current) {
            raf.current = requestAnimationFrame(() => {
              raf.current = 0;
              onChange();
            });
          }
          return;
        }
        const s = selRef.current;
        if (!s) return;
        const m = mm(e);
        if (s.idx !== index && !transfer(s, S, sheet, index, m)) return;
        s.pm = m;
        moveTo(s, S, m[0] - s.off[0], m[1] - s.off[1]);
        // redraw at most once per frame so dragging stays smooth
        if (!raf.current) {
          raf.current = requestAnimationFrame(() => {
            raf.current = 0;
            onChange();
          });
        }
      }}
      onClick={(e) => {
        const cm = multiRef.current;
        if (cm?.carry && cm.sh === sheet) {
          // click = drop the carried group where it is (it is always in a legal spot)
          cm.carry = false;
          cm.drag = undefined;
          onChange();
          return;
        }
        const s = selRef.current;
        if (!s) return;
        if (s.bad) return; // red = overlapping: move to a free spot (or Esc) first
        // a part still floating outside every sheet drops in only if there is room at the click
        if (inGhost(s) && !transfer(s, S, sheet, index, mm(e))) return;
        if (s.idx === index) {
          const m = mm(e);
          moveTo(s, S, m[0] - s.off[0], m[1] - s.off[1]);
        }
        selRef.current = null;
        onChange();
      }}
    />
  );
}

// mm-per-unit for the unit label the server-side DXF parser detected.
const UNIT_SCALE: Record<string, number> = { in: 25.4, ft: 304.8, mm: 1, cm: 10, m: 1000, "µm": 0.001, dm: 100 };

export function NestBoost() {
  const { projectId, projects, nestingQueue, clearNestingQueue } = useTakeoffProject();
  const [reporting, setReporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  // Takeoff part ids already imported into this session, so pressing
  // "Import" twice never doubles the quantities.
  const importedIds = React.useRef<Set<string>>(new Set());
  const [groups, setGroups] = React.useState<Group[]>([]);
  const groupsRef = React.useRef<Group[]>([]);
  const counters = React.useRef<Counters>({ id: 0, sn: 0 });
  const [msg, setMsg] = React.useState(DEFAULT_MSG);
  const [units, setUnits] = React.useState("1");
  const [cfg, setCfg] = React.useState({
    W: "6000", H: "1500", mg: "5", gp: "5", cell: "5", ro: "2", tm: "20", pair: true, common: false,
  });
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<OptResult | null>(null);
  const [resS, setResS] = React.useState<Settings | null>(null);
  const [version, setVersion] = React.useState(0);
  const [confirmReset, setConfirmReset] = React.useState(false);
  // Multi-select in "Parts & quantities" + the "Are you sure?" for removals.
  const [checked, setChecked] = React.useState<Set<number>>(new Set());
  const [pendingRemove, setPendingRemove] = React.useState<number[] | null>(null);
  const [confirmOptimize, setConfirmOptimize] = React.useState(false);
  // ---- box selection (CAD style): parts selected together on one sheet, moved as a group
  const multiRef = React.useRef<MultiSel | null>(null);
  const [multiCount, setMultiCount] = React.useState(0);
  const [carrying, setCarrying] = React.useState(false);
  const [selectMode, setSelectMode] = React.useState(false); // touch screens: drag on a sheet = selection box
  const [pendingClear, setPendingClear] = React.useState<number | null>(null); // sheet index waiting for "Clear sheet" confirmation

  // ---- manual nesting: which material/thickness the "Add empty sheet" button uses,
  // whether the mouse button is still down after pressing a part in the list, and where to draw the floating part.
  const [lotSel, setLotSel] = React.useState("");
  const dragRef = React.useRef(false);
  const [ghostPos, setGhostPos] = React.useState({ x: -999, y: -999 });
  const resultRef = React.useRef<OptResult | null>(null);
  React.useEffect(() => {
    resultRef.current = result;
  }, [result]);
  React.useEffect(() => {
    const up = () => {
      dragRef.current = false;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // Saved nests (unlimited) so several attempts can be kept and compared.
  const [savedNests, setSavedNests] = React.useState<SavedNest[]>([]);
  const savedSeq = React.useRef(0);
  const [nestName, setNestName] = React.useState("");
  const [activeNestId, setActiveNestId] = React.useState<number | null>(null);

  const selRef = React.useRef<Sel | null>(null);
  const runRef = React.useRef(0);
  const stopRef = React.useRef(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  // What is currently picked up — mirrored into state so the UI can render it
  // (the live selection itself stays in selRef because it is mutated per mouse move).
  const [held, setHeld] = React.useState<{ idx: number; sn: number; name: string; bad: boolean; fresh: boolean; ghost: boolean } | null>(null);
  const bump = React.useCallback(() => {
    // nothing in hand any more: refresh what is still left to place after a manual change
    const r = resultRef.current;
    // drop selected parts that are no longer on their sheet (removed, cleared, new result...)
    const ms = multiRef.current;
    if (ms) {
      if (!r || !r.sheets.includes(ms.sh)) multiRef.current = null;
      else {
        ms.items = ms.items.filter((it) => ms.sh.items.includes(it));
        ms.idx = r.sheets.indexOf(ms.sh);
        if (!ms.items.length) multiRef.current = null;
      }
    }
    setMultiCount(multiRef.current?.items.length ?? 0);
    setCarrying(!!multiRef.current?.carry);
    if (r?.manual && !selRef.current) syncUnplaced(r, groupsRef.current);
    setVersion((v) => v + 1);
    const s = selRef.current;
    const next = s
      ? { idx: s.idx, sn: s.it.g.sn, name: s.it.g.name, bad: !!s.bad, fresh: !!s.fresh, ghost: inGhost(s) }
      : null;
    // keep the same object when nothing changed so mouse moves don't re-render the whole page
    setHeld((p) =>
      p && next && p.idx === next.idx && p.sn === next.sn && p.bad === next.bad && p.fresh === next.fresh && p.ghost === next.ghost ? p : next,
    );
  }, []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => setWidth(Math.max(300, el.clientWidth));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setG = (g: Group[]) => {
    groupsRef.current = g;
    setGroups(g);
  };

  /** Drops the nesting result (and stops a running optimisation). */
  const clearResults = () => {
    runRef.current++;
    stopRef.current = true;
    selRef.current = null;
    setResult(null);
    setResS(null);
    setRunning(false);
    setStatus("");
    setActiveNestId(null);
    bump();
  };

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    let gs = groupsRef.current;
    let text = "";
    for (const f of files) {
      const r = parseDXF(await f.text());
      const added = addFileParts(gs, r.loops, f.name, +units, counters.current);
      gs = added.groups;
      text +=
        `${f.name}: ${r.loops.length} contours → ${added.count} part(s)` +
        (r.skip.length ? ` (unsupported/approximated: ${r.skip.join(", ")})` : "") +
        "\n";
    }
    setG(gs);
    setMsg(text);
  }

  /**
   * Pulls the DXF + quantity + thickness of parts straight from Standard
   * Calculations. `onlyIds` = parts sent one by one; omitted = every part in
   * the project that has a valid DXF.
   */
  const importFromProject = React.useCallback(
    async (onlyIds?: string[]) => {
      if (!projectId) {
        toast.error("Select a project first");
        return;
      }
      setImporting(true);
      try {
        const res = await fetch(`/api/takeoff/drawings?projectId=${projectId}`);
        if (!res.ok) throw new Error("Failed to load the parts list");
        const drawings: TakeoffDrawingRow[] = await res.json();
        const wanted = onlyIds ? new Set(onlyIds) : null;

        let gs = groupsRef.current;
        let text = "";
        let ok = 0;
        const skipped: string[] = [];

        for (const d of drawings) {
          for (const part of d.parts) {
            if (wanted && !wanted.has(part.id)) continue;
            const label = `${d.drawingNumber} #${part.itemNo} ${part.description}`;
            // Only plates are nested in 2D; everything else goes to the 1D tool.
            if (nestKindOf(part.partType) !== "2D") {
              if (!wanted) continue; // bulk import: silently leave 1D parts to the 1D tool
              skipped.push(`${label}: ${part.partType} is not a plate — use the 1D tool`);
              continue;
            }
            if (importedIds.current.has(part.id)) { skipped.push(`${label}: already imported`); continue; }
            if (!part.dxf) { skipped.push(`${label}: no DXF`); continue; }
            if (!part.dxf.valid) { skipped.push(`${label}: DXF invalid`); continue; }
            if (part.qty <= 0) { skipped.push(`${label}: qty is 0`); continue; }
            const r = await fetch(`/api/takeoff/parts/${part.id}/dxf`);
            if (!r.ok) { skipped.push(`${label}: could not read file`); continue; }
            const parsed = parseDXF(await r.text());
            const scale = UNIT_SCALE[part.dxf.unitsDetected ?? "mm"] ?? +units;
            const added = addFileParts(gs, parsed.loops, label, scale, counters.current, {
              th: part.thicknessMm ?? 0,
              material: part.material ?? "",
              qty: part.qty,
            });
            gs = added.groups;
            importedIds.current.add(part.id);
            ok++;
            const matLbl = part.material ? `${part.material}, ` : "";
            text += `${label}: ${part.qty} pcs, ${matLbl}${part.thicknessMm ?? "?"} mm → ${added.count} contour(s)\n`;
          }
        }
        setG(gs);
        if (ok) clearResults();
        setMsg((text + (skipped.length ? `\nSkipped:\n${skipped.join("\n")}` : "")).trim() || "Nothing to import.");
        if (ok) toast.success(`Imported ${ok} part(s) from Standard Calculations`);
        else toast.warning("No parts were imported");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImporting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, units],
  );

  // Parts sent one-by-one from the Standard Calculations tab.
  React.useEffect(() => {
    if (!nestingQueue.length || !projectId) return;
    const ids = nestingQueue;
    clearNestingQueue();
    importFromProject(ids);
  }, [nestingQueue, projectId, clearNestingQueue, importFromProject]);

  const updateGroup = (id: number, patch: Partial<Group>) => {
    setG(groupsRef.current.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    if (resultRef.current?.manual) bump(); // quantity changed: what is left to place changes too
  };

  const removeParts = (ids: number[]) => {
    const drop = new Set(ids);
    const gone = groupsRef.current.filter((x) => drop.has(x.id));
    setG(groupsRef.current.filter((x) => !drop.has(x.id)));
    setChecked(new Set());
    clearResults();
    setMsg(
      gone.length === 1
        ? `Part #${gone[0].sn} (${gone[0].name}) removed. Press Optimize to re-nest.`
        : `${gone.length} parts removed. Press Optimize to re-nest.`,
    );
  };

  const resetAll = () => {
    setG([]);
    setChecked(new Set());
    importedIds.current = new Set();
    counters.current = { id: 0, sn: 0 };
    clearResults();
    setMsg(DEFAULT_MSG);
    setConfirmReset(false);
  };

  /** Sheet settings typed on the left, or null when they are invalid. */
  function readSettings(): Settings | null {
    const v = {
      W: Number(cfg.W), H: Number(cfg.H), mg: Number(cfg.mg), gp: Number(cfg.gp),
      cell: Number(cfg.cell), ro: Number(cfg.ro),
    };
    if (!(v.W > 0 && v.H > 0 && v.cell > 0 && v.mg >= 0 && v.gp >= 0)) return null;
    return makeSettings(v);
  }

  // Manual nesting works on the same result object as the optimiser: sheets/items are mutated in place, then bump().
  function manualResult(S: Settings): OptResult {
    const cur = resultRef.current;
    if (cur && resS) return cur;
    const fresh: OptResult = { sheets: [], un: [], skip: [], manual: true };
    resultRef.current = fresh;
    setResS(S);
    setResult(fresh);
    return fresh;
  }

  /** Adds an empty sheet for the chosen material / thickness. */
  function addSheet() {
    const lot = lots.find((l) => l.key === lotKey);
    if (!lot || running) return;
    const S = resS ?? readSettings();
    if (!S) {
      toast.error("Check the sheet settings (length, width, margin, spacing).");
      return;
    }
    const res = manualResult(S);
    res.sheets.push(newSheet(lot.th, lot.material));
    res.manual = true;
    syncUnplaced(res, groupsRef.current);
    bump();
  }

  /** Empties a sheet: every part on it goes back to the list (its "left" count goes up); the sheet itself stays. */
  function clearSheet(i: number) {
    const r = resultRef.current;
    if (!r || selRef.current || !r.sheets[i]) return; // never while holding a part
    r.sheets[i].items.length = 0;
    r.manual = true; // "not nested" is now derived from the quantities
    bump();
  }

  function deleteSheet(i: number) {
    const r = resultRef.current;
    if (!r || selRef.current || r.sheets[i]?.items.length) return; // only empty sheets, and never while holding a part
    r.sheets.splice(i, 1);
    bump();
  }

  /**
   * Press on a part in the list to take one copy in your hand. Hold the button and drop it on a sheet, or just click
   * it and click again on the sheet. It is refused when every piece of that part is already on a sheet.
   */
  function holdFromList(g: Group, e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).releasePointerCapture?.(e.pointerId); // touch: let the sheet under the finger receive the moves
    if (running) {
      toast.warning("Optimisation is running — press Stop first");
      return;
    }
    const cur = selRef.current;
    if (cur) {
      if (!cur.fresh) {
        toast.warning("Place the part you are holding first (or press Esc)");
        return;
      }
      cancelPick(cur); // swap the copy in hand for this one
      selRef.current = null;
    }
    const left = leftOf(g, placedCounts(resultRef.current));
    if (left <= 0) {
      toast.warning(`Part #${g.sn}: all ${g.qty} pc(s) are already on sheets`);
      bump();
      return;
    }
    const S = resS ?? readSettings();
    if (!S) {
      toast.error("Check the sheet settings (length, width, margin, spacing).");
      return;
    }
    const res = manualResult(S);
    const same = (sh: { th: number; material: string }) => (sh.th || 0) === (g.th || 0) && (sh.material || "") === (g.material || "");
    if (!res.sheets.some(same)) res.sheets.push(newSheet(g.th, g.material)); // first sheet for this material/thickness
    res.manual = true;
    multiRef.current = null; // a part in hand replaces any box selection
    selRef.current = startNew(g);
    dragRef.current = true;
    setGhostPos({ x: e.clientX, y: e.clientY });
    bump();
  }

  /** Takes the part in hand off its sheet (or drops the new copy): its piece becomes available in the list again. */
  const removeHeld = React.useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    const a = s.sh.items;
    const i = a.indexOf(s.it);
    if (i >= 0) a.splice(i, 1);
    selRef.current = null;
    if (resultRef.current) resultRef.current.manual = true;
    bump();
  }, [bump]);

  /** Takes every box-selected part off its sheet: their pieces become available in the list again. */
  const removeSelected = React.useCallback(() => {
    const m = multiRef.current;
    if (!m || m.drag) return;
    for (const it of m.items) {
      const i = m.sh.items.indexOf(it);
      if (i >= 0) m.sh.items.splice(i, 1);
    }
    multiRef.current = null;
    if (resultRef.current) resultRef.current.manual = true;
    bump();
  }, [bump]);

  async function start() {
    multiRef.current = null;
    const S = readSettings();
    if (!S) {
      setStatus("Check the sheet settings (length, width, margin, spacing).");
      return;
    }
    setActiveNestId(null);
    const my = ++runRef.current;
    stopRef.current = false;
    selRef.current = null;
    bump();
    setRunning(true);
    setStatus("");
    const res = await runOptimize(groupsRef.current, {
      S,
      pair: cfg.pair,
      common: cfg.common,
      timeSec: Number(cfg.tm) || 20,
      shouldStop: () => stopRef.current || my !== runRef.current,
      onBest: (r) => {
        if (my !== runRef.current) return;
        setResS(S);
        setResult(r);
      },
      onStatus: (t) => {
        if (my === runRef.current) setStatus(t);
      },
    });
    if (my !== runRef.current) return;
    if (!res) setStatus("Nothing to nest — all quantities are 0.");
    else {
      setResS(S);
      setResult(res);
    }
    setRunning(false);
  }

  /** Keeps a copy of the current nest (result + settings + parts) so it can be compared with other attempts. */
  function saveNest() {
    if (!result || !resS || running) return;
    const id = ++savedSeq.current;
    const snap: SavedNest = {
      id,
      name: nestName.trim() || `Nest ${id}`,
      savedAt: Date.now(),
      cfg: { ...cfg },
      S: resS,
      result: cloneResult(result),
      groups: groupsRef.current,
    };
    setSavedNests((p) => [...p, snap]);
    setActiveNestId(id);
    setNestName("");
    toast.success(`Saved "${snap.name}"`);
  }

  function openSavedNest(n: SavedNest) {
    runRef.current++;
    stopRef.current = true;
    selRef.current = null;
    setRunning(false);
    setStatus("");
    setCfg({ ...n.cfg });
    setG(n.groups);
    setResS(n.S);
    setResult(cloneResult(n.result));
    setActiveNestId(n.id);
    bump();
    toast.success(`Opened "${n.name}" — its settings and parts were restored`);
  }

  function exportDxf() {
    if (!result || !resS) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buildDxf(result.sheets, resS)], { type: "application/dxf" }));
    a.download = "nested.dxf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Report input for this tool's current result (also used by the combined 1D+2D report). */
  const getReportInput = React.useCallback((): Report2DInput | null => {
    if (!result || !resS) return null;
    const S = resS;
    return {
      projectName: projects.find((p) => p.id === projectId)?.name,
      result,
      S,
      groups: groupsRef.current,
      renderSheet: (i) => {
        const sh = result.sheets[i];
        const W = sh.W ?? S.W;
        const H = sh.H ?? S.H;
        const k = Math.min(1, 1400 / W);
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(W * k));
        cv.height = Math.max(1, Math.round(H * k));
        drawSheet(sh, cv, k, S, null);
        const out = document.createElement("canvas");
        out.width = cv.width;
        out.height = cv.height;
        const c = out.getContext("2d");
        if (!c) return null;
        c.fillStyle = "#fff";
        c.fillRect(0, 0, out.width, out.height);
        c.drawImage(cv, 0, 0);
        c.strokeStyle = "#475569";
        c.strokeRect(0.5, 0.5, out.width - 1, out.height - 1);
        return { dataUrl: out.toDataURL("image/png"), width: out.width, height: out.height };
      },
    };
  }, [result, resS, projects, projectId]);

  // Lets the combined 1D+2D report button reach this tool's latest result.
  React.useEffect(() => {
    register2D(!!result && !running && result.sheets.length > 0 ? getReportInput : null);
    return () => register2D(null);
  }, [result, running, getReportInput]);

  /** Excel report: material used, scrap (m² / kg), parts nested and a picture of every sheet. */
  async function exportReport() {
    const input = getReportInput();
    if (!input) return;
    setReporting(true);
    try {
      const [{ buildReport2D }, { saveBlob }] = await Promise.all([import("./../report/report-2d"), import("./../report/excel-common")]);
      saveBlob(await buildReport2D(input), "nesting-report-2d.xlsx");
      toast.success("Report downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the report");
    } finally {
      setReporting(false);
    }
  }

  // keyboard while a part is picked up
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!resS) return;
      // box-selected group (nothing in hand): Esc = deselect / cancel the move, Delete = back to list, arrows = nudge
      const ms = multiRef.current;
      if (!selRef.current && ms) {
        if (e.key === "Escape") {
          if (ms.drag) cancelGroupDrag(ms);
          multiRef.current = null;
          bump();
          return;
        }
        if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select")) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          removeSelected();
          return;
        }
        const st = (e.shiftKey ? 10 : 1) * resS.cell; // parts sit on the optimiser's grid, so one step = one grid cell
        const nv: Record<string, Pt> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] };
        if (nv[e.key] && !ms.drag) {
          e.preventDefault();
          nudgeGroup(ms, resS, nv[e.key][0], nv[e.key][1]);
          bump();
        }
        return;
      }
      const sel = selRef.current;
      if (!sel) return;
      if (e.key === "Escape") {
        cancelPick(sel);
        selRef.current = null;
        bump();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement | null)?.closest?.("input,textarea,select")) {
        e.preventDefault();
        removeHeld();
        return;
      }
      const d = e.shiftKey ? 10 : 1;
      const mv: Record<string, Pt> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
      const m = mv[e.key];
      if (m) {
        e.preventDefault();
        moveTo(sel, resS, sel.it.x + m[0], sel.it.y + m[1]);
        bump();
      } else if (e.key === "r" || e.key === "R") {
        rotate(sel, resS, 90);
        bump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resS, bump, removeHeld, removeSelected]);

  const problems = result && resS ? problemMessages(result, resS) : [];
  const placed = placedCounts(result); // pieces of each part already on a sheet (recomputed on every render/bump)
  const stillToPlace = groups.map((g) => ({ g, n: leftOf(g, placed) })).filter((x) => x.n > 0);
  const lotMap = new Map<string, { key: string; th: number; material: string; label: string }>();
  for (const g of groups) {
    const th = g.th || 0;
    const material = g.material || "";
    const key = `${th}\u0000${material}`;
    if (!lotMap.has(key)) lotMap.set(key, { key, th, material, label: `${material ? `${material} • ` : ""}${th ? `${th} mm` : "thickness ?"}` });
  }
  const lots = [...lotMap.values()].sort((a, b) => a.th - b.th || a.material.localeCompare(b.material));
  const lotKey = lots.some((l) => l.key === lotSel) ? lotSel : (lots[0]?.key ?? "");
  const canExport = !!result && !running && result.sheets.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1. Import</h3>
          <label
            className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border p-5 text-center text-sm text-muted-foreground hover:bg-secondary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFiles(Array.from(e.dataTransfer.files).filter((f) => /\.dxf$/i.test(f.name)));
            }}
          >
            <Upload className="h-5 w-5" />
            Drop DXF files here or click
            <input
              type="file"
              accept=".dxf"
              multiple
              hidden
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                e.target.value = ""; // allow re-importing the same file after a reset
                handleFiles(fs);
              }}
            />
          </label>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={!projectId || importing}
            onClick={() => importFromProject()}
            title="Import every plate of the selected project that has a valid DXF, with its quantity and thickness"
          >
            {importing ? <Loader2 className="animate-spin" /> : <FolderInput />} Import plates from Standard Calculations
          </Button>
          {!projectId && <p className="mt-1 text-xs text-muted-foreground">Select a project above to enable this.</p>}
          <div className="mt-2">
            <Field label="Drawing units (manual uploads only)">
              <select className={selectCls} value={units} onChange={(e) => setUnits(e.target.value)}>
                <option value="1">mm</option>
                <option value="25.4">inch</option>
              </select>
            </Field>
          </div>
          <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{msg}</p>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2. Sheet &amp; settings</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sheet length (mm)">
              <Input type="number" value={cfg.W} onChange={(e) => setCfg({ ...cfg, W: e.target.value })} />
            </Field>
            <Field label="Sheet width (mm)">
              <Input type="number" value={cfg.H} onChange={(e) => setCfg({ ...cfg, H: e.target.value })} />
            </Field>
            <Field label="Edge margin (mm)">
              <Input type="number" value={cfg.mg} onChange={(e) => setCfg({ ...cfg, mg: e.target.value })} />
            </Field>
            <Field label="Part spacing (mm)">
              <Input type="number" value={cfg.gp} onChange={(e) => setCfg({ ...cfg, gp: e.target.value })} />
            </Field>
            {/* <Field label="Grid cell (mm) – smaller = tighter, slower">
              <select className={selectCls} value={cfg.cell} onChange={(e) => setCfg({ ...cfg, cell: e.target.value })}>
                <option>3</option>
                <option>5</option>
                <option>8</option>
              </select>
            </Field> */}
            <Field label="Rotation">
              <select className={selectCls} value={cfg.ro} onChange={(e) => setCfg({ ...cfg, ro: e.target.value })}>
                <option value="0">None</option>
                <option value="1">0° / 180°</option>
                <option value="2">90° steps</option>
                <option value="3">45° steps</option>
                <option value="4">15° steps (slower)</option>
              </select>
            </Field>
            <Field label="Optimize time (s)">
              <Input type="number" value={cfg.tm} onChange={(e) => setCfg({ ...cfg, tm: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-muted-foreground">
              <Checkbox checked={cfg.pair} onCheckedChange={(v) => setCfg({ ...cfg, pair: v === true })} />
              Auto-pair triangles
            </label>
            <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={cfg.common} onCheckedChange={(v) => setCfg({ ...cfg, common: v === true })} />
              Common cut line (no gap inside pair)
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => (result?.manual && result.sheets.some((x) => x.items.length) ? setConfirmOptimize(true) : start())}
              disabled={running || !groups.length}
            >
              <Layers /> Optimize nest
            </Button>
            <Button variant="secondary" onClick={() => (stopRef.current = true)} disabled={!running}>
              Stop
            </Button>
            <Button variant="secondary" onClick={exportDxf} disabled={!canExport}>
              <Download /> Export DXF
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{status}</p>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parts &amp; quantities</h3>
            <div className="flex items-center gap-2">
            {checked.size > 0 && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setPendingRemove([...checked])}>
                <Trash2 /> Remove selected ({checked.size})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={!groups.length}
              onClick={() => setConfirmReset(true)}
            >
              <Trash2 /> Reset all
            </Button>
            </div>
          </div>
          {!groups.length ? (
            <p className="text-sm text-muted-foreground">No parts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">
                      <Checkbox
                        aria-label="Select all parts"
                        checked={
                          groups.length > 0 && groups.every((g) => checked.has(g.id))
                            ? true
                            : checked.size > 0 ? "indeterminate" : false
                        }
                        onCheckedChange={(v) => setChecked(v === true ? new Set(groups.map((g) => g.id)) : new Set())}
                      />
                    </th>
                    <th className="p-1">#</th>
                    <th className="p-1" />
                    <th className="p-1">File</th>
                    <th className="p-1">Size (mm)</th>
                    <th className="p-1">Area</th>
                    <th className="p-1">Holes</th>
                    <th className="p-1">Thick (mm)</th>
                    <th className="p-1">Material</th>
                    <th className="p-1">Qty</th>
                    <th className="p-1">Placed</th>
                    <th className="p-1" title="Press a part's picture to take one piece and place it by hand">Left / place by hand</th>
                    <th className="p-1" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className={`border-t border-border ${checked.has(g.id) ? "bg-primary/5" : ""}`}>
                      <td className="p-1">
                        <Checkbox
                          aria-label={`Select part #${g.sn}`}
                          checked={checked.has(g.id)}
                          onCheckedChange={(v) =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(g.id); else next.delete(g.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="p-1 font-semibold">#{g.sn}</td>
                      <td className="p-1"><PartThumb g={g} /></td>
                      <td className="p-1">{g.name}</td>
                      <td className="p-1 whitespace-nowrap">{g.w.toFixed(1)} × {g.h.toFixed(1)}</td>
                      <td className="p-1">{Math.round(g.area)}</td>
                      <td className="p-1">{g.holes.length}</td>
                      <td className="p-1">
                        <Input
                          type="number" min={0} step="any" placeholder="mm" className="h-8 w-20"
                          value={g.th || ""}
                          onChange={(e) => updateGroup(g.id, { th: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          type="text" placeholder="e.g. S235" className="h-8 w-24"
                          value={g.material || ""}
                          onChange={(e) => updateGroup(g.id, { material: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          type="number" min={0} className="h-8 w-20" value={g.qty}
                          onChange={(e) => updateGroup(g.id, { qty: Math.max(0, Number(e.target.value) | 0) })}
                        />
                      </td>
                      <td className="p-1 whitespace-nowrap tabular-nums">{placed.get(g.id) ?? 0}</td>
                      <td className="p-1">
                        {(() => {
                          const left = leftOf(g, placed);
                          return (
                            <button
                              type="button"
                              disabled={left <= 0 || running}
                              onPointerDown={(e) => holdFromList(g, e)}
                              title={
                                left > 0
                                  ? "Press and hold, drag onto a sheet and release — or click, then click on the sheet"
                                  : "All pieces of this part are already placed"
                              }
                              className={`flex select-none items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
                                left > 0
                                  ? "cursor-grab border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 active:cursor-grabbing"
                                  : "cursor-not-allowed border-border text-muted-foreground opacity-60"
                              }`}
                              style={{ touchAction: "none" }}
                            >
                              <Plus className="h-3 w-3" /> {left} left
                            </button>
                          );
                        })()}
                      </td>
                      <td className="p-1">
                        <Button variant="ghost" size="sm" className="text-destructive" title="Remove this part" onClick={() => setPendingRemove([g.id])}>
                          <Trash2 /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nesting result</h3>
          {groups.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 p-2">
              <span className="text-xs font-semibold">Manual nesting</span>
              <select className={`${selectCls} !w-auto`} value={lotKey} onChange={(e) => setLotSel(e.target.value)} disabled={running}>
                {lots.map((l) => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </select>
              <Button variant="secondary" size="sm" onClick={addSheet} disabled={running || !lots.length}>
                <Plus /> Add empty sheet
              </Button>
              <Button
                variant={selectMode ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectMode((v) => !v)}
                title="Touch screens: when on, dragging on a sheet draws a selection box instead of scrolling the page"
              >
                Touch select {selectMode ? "on" : "off"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Press a part in the table (&quot;Left / place by hand&quot;) and drop it on a sheet. When its count reaches 0 it can&apos;t be taken again;
                put a piece back with Delete to free it.
              </span>
            </div>
          )}
          {stillToPlace.length > 0 && result?.manual && (
            <p className="mb-2 text-xs text-muted-foreground">
              Still to place: {stillToPlace.map(({ g, n }) => `#${g.sn} ×${n}`).join(" • ")}
            </p>
          )}
          <p className="mb-2 text-xs text-muted-foreground">
            Select like CAD: drag a box on a sheet — <span className="font-medium text-blue-600">left → right</span> selects only the parts completely
            inside the box, <span className="font-medium text-green-600">right → left</span> selects every part the box touches (Shift adds to the
            selection). Then drag any selected part to move them all together, or double-click one to pick them all up and click to place (arrow keys move one grid cell, Delete puts them back to the list, Esc clears).
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            Double-click a part to pick it up: it follows the mouse (move it onto another sheet of the same thickness to
            transfer it), scroll the wheel to rotate freely (5° per notch, hold Shift for 1°; R = 90°), click to place, Esc to cancel. While moving, it can&apos;t overlap other parts,
            break the spacing, or enter the margin (it stays at the last allowed position). Rotation is never blocked: if there&apos;s no room the part
            turns anyway and goes red — drag it to a free spot to place it.
          </p>
          {!held && multiCount > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/5 p-2">
              <span className="text-xs font-medium">{multiCount} part{multiCount > 1 ? "s" : ""} selected</span>
              {!carrying && (
                <Button variant="outline" size="sm" className="text-destructive" onClick={removeSelected} title="Take the selected parts off the sheet (Delete key)">
                  <Undo2 /> Put back to list
                </Button>
              )}
              {carrying ? (
                <>
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => { const m = multiRef.current; if (m) { m.carry = false; m.drag = undefined; } bump(); }}
                  >
                    <Check /> Place here
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Holding the whole selection — move the mouse over the sheet, click to place, Esc to cancel. It stops at other parts, the spacing and the margin.
                  </span>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { multiRef.current = null; bump(); }}>
                    Clear selection
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Drag one of them to move the whole selection, or double-click one to pick them all up — it stops at other parts, the spacing and the margin.
                  </span>
                </>
              )}
            </div>
          )}
          {held && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => { if (resS && selRef.current) { rotate(selRef.current, resS, 90); bump(); } }}>
                <RotateCcw /> Rotate 90°
              </Button>
              <Button variant="secondary" size="sm" disabled={held.bad || held.ghost} onClick={() => { selRef.current = null; bump(); }}>
                <Check /> Done
              </Button>
              <Button variant="outline" size="sm" className="text-destructive" onClick={removeHeld} title="Take this piece off the sheets (Delete key) — it becomes available in the list again">
                <Undo2 /> {held.fresh ? "Drop it" : "Put back to list"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {held.ghost
                  ? `Holding a new Part #${held.sn} (${held.name}) — move it over a sheet of the same material/thickness and click`
                  : held.bad
                    ? `Part #${held.sn} overlaps something (red) — move it to a free spot to place it, or press Esc to cancel`
                    : `Holding: Part #${held.sn} (${held.name}) — move the mouse, scroll to rotate, click to place`}
              </span>
            </div>
          )}
          <div ref={boxRef} className="space-y-4">
            {!result || !resS ? (
              <p className="text-sm text-muted-foreground">Import parts, then press Optimize — or press a part in the table to nest it by hand.</p>
            ) : (
              result.sheets.map((sh, i) => {
                const st = sheetStats(sh, resS);
                return (
                  <div key={i}>
                    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        <b className="text-foreground">Sheet {i + 1}</b> — {sh.material ? `${sh.material} • ` : ""}{sh.th ? `${sh.th} mm plate • ` : ""}
                        {st.parts} parts • utilization {st.utilization.toFixed(1)}%
                      </span>
                      <span className="flex items-center gap-1">
                        Cut size
                        <Input
                          type="number" min={1} className="h-7 w-20"
                          value={Math.round(sh.W ?? resS.W)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v > 0) resizeSheet(sh, resS, v, sh.H ?? resS.H);
                            bump();
                          }}
                        />
                        ×
                        <Input
                          type="number" min={1} className="h-7 w-20"
                          value={Math.round(sh.H ?? resS.H)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v > 0) resizeSheet(sh, resS, sh.W ?? resS.W, v);
                            bump();
                          }}
                        />
                        mm
                      </span>
                      <Button
                        variant="ghost" size="sm" className="h-7"
                        title="Shrink this sheet to just fit its parts, to cut less material / less scrap"
                        onClick={() => {
                          const m = minSheetSize(sh, resS);
                          resizeSheet(sh, resS, m.w, m.h);
                          bump();
                        }}
                      >
                        Fit to parts
                      </Button>
                      {sh.items.length > 0 && (
                        <Button
                          variant="ghost" size="sm" className="h-7 text-destructive" disabled={!!held || running}
                          title="Take every part off this sheet and give them back to the list"
                          onClick={() => setPendingClear(i)}
                        >
                          <Trash2 /> Clear sheet
                        </Button>
                      )}
                      {sh.items.length === 0 && (
                        <Button variant="ghost" size="sm" className="h-7 text-destructive" disabled={!!held} onClick={() => deleteSheet(i)}>
                          <Trash2 /> Delete empty sheet
                        </Button>
                      )}
                      {(sh.W !== undefined || sh.H !== undefined) && (
                        <Button
                          variant="ghost" size="sm" className="h-7"
                          onClick={() => {
                            sh.W = undefined;
                            sh.H = undefined;
                            bump();
                          }}
                        >
                          Reset to full sheet
                        </Button>
                      )}
                    </div>
                    <SheetCanvas sheet={sh} index={i} S={resS} width={width} selRef={selRef} version={version} heldIdx={held ? held.idx : null} dragRef={dragRef} multiRef={multiRef} selectMode={selectMode} onChange={bump} />
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <Input
              className="h-9 w-44" placeholder="Name (optional)" value={nestName}
              onChange={(e) => setNestName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canExport) saveNest(); }}
              disabled={!canExport}
            />
            <Button variant="secondary" onClick={saveNest} disabled={!canExport} title="Keep this nest so you can try another one and compare them">
              <Save /> Save this nest
            </Button>
            <Button onClick={exportReport} disabled={!canExport || reporting} title="Excel report: material used, scrap, parts nested and a picture of every sheet">
              {reporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Create report (.xlsx)
            </Button>
          </div>
          {problems.length > 0 && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4" /> Nesting problems
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {problems.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <SavedNestsCard
          nests={savedNests}
          activeId={activeNestId}
          onLoad={openSavedNest}
          onDelete={(id) => {
            setSavedNests((p) => p.filter((n) => n.id !== id));
            setActiveNestId((a) => (a === id ? null : a));
          }}
          onRename={(id, name) => setSavedNests((p) => p.map((n) => (n.id === id ? { ...n, name } : n)))}
        />
      </div>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(v) => !v && setPendingRemove(null)}
        title={
          pendingRemove && pendingRemove.length > 1
            ? `Are you sure you want to remove ${pendingRemove.length} parts?`
            : "Are you sure you want to remove this part?"
        }
        description="The nesting result will be cleared and you'll need to press Optimize again."
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingRemove) removeParts(pendingRemove);
          setPendingRemove(null);
        }}
      />

      {held?.ghost && <GhostPart selRef={selRef} version={version} init={ghostPos} />}

      <ConfirmDialog
        open={pendingClear !== null}
        onOpenChange={(v) => !v && setPendingClear(null)}
        title={pendingClear !== null ? `Clear sheet ${pendingClear + 1}?` : "Clear sheet?"}
        description="Every part on this sheet goes back to the list so you can nest it again. The sheet itself stays."
        confirmLabel="Clear sheet"
        onConfirm={() => {
          if (pendingClear !== null) clearSheet(pendingClear);
          setPendingClear(null);
        }}
      />

      <ConfirmDialog
        open={confirmOptimize}
        onOpenChange={setConfirmOptimize}
        title="Replace your manual nesting?"
        description="Optimize builds a new automatic nest and discards the parts you placed by hand. Save this nest first if you want to keep it."
        confirmLabel="Optimize"
        onConfirm={() => {
          setConfirmOptimize(false);
          start();
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset all parts?"
        description="This removes every imported part and the current nesting result."
        confirmLabel="Reset all"
        onConfirm={resetAll}
      />
    </div>
  );
}