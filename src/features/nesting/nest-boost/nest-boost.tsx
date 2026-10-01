"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FolderInput, Layers, Loader2, Maximize2, Minimize2, Plus, Redo2, RotateCcw, Save, Search, SlidersHorizontal, Trash2, TriangleAlert, Undo2, Upload } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { angleClick, setAngleFeedback } from "./angle-feedback";
import { canRedo, canUndo, record, redo, resetHistory, undo, type NestHistory } from "./history";
import { cloneResult, SavedNestsCard, type SavedNest } from "./saved-nests";
import { SheetStrip } from "./sheet-strip";
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
  fitSheetToParts,
  moveGroup,
  moveTo,
  newSheet,
  nudgeGroup,
  rotateGroup,
  rotateGroupSnap,
  rotateSnap,
  separateGroup,
  bbox,
  sides,
  isDetent,
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
  transferGroup,
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

/** Larger part picture for the TruTops-style strip (sharp on high-DPI screens). */
function StripThumb({ g, w = 112, h = 76 }: { g: Group; w?: number; h?: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    const pad = 4;
    const k = Math.min((w - pad * 2) / (g.w || 1), (h - pad * 2) / (g.h || 1)) * dpr;
    const ox = (cv.width - g.w * k) / 2;
    const oy = (cv.height + g.h * k) / 2;
    c.setTransform(k, 0, 0, -k, ox, oy);
    const P = path(g, 0, 0, 0);
    c.fillStyle = partColor(g);
    c.fill(P, "evenodd");
    c.lineWidth = 1.2 / k;
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.stroke(P);
  }, [g, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

/**
 * TruTops-style "parts not nested yet" strip: one card per part (name, picture, "left of total"),
 * horizontally scrollable, with a search box and sorting. Press a card and drag it onto the sheet.
 */
function UnplacedStrip({
  items, running, onHold,
}: {
  items: { g: Group; n: number }[];
  running: boolean;
  onHold: (g: Group, e: React.PointerEvent) => void;
}) {
  const [q, setQ] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"name" | "left" | "size">("name");
  const [asc, setAsc] = React.useState(true);
  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = items.filter(({ g }) => !needle || `${g.name} #${g.sn}`.toLowerCase().includes(needle));
    const dir = asc ? 1 : -1;
    return [...f].sort((a, b) => {
      if (sortBy === "left") return (a.n - b.n) * dir || a.g.sn - b.g.sn;
      if (sortBy === "size") return (a.g.area - b.g.area) * dir || a.g.sn - b.g.sn;
      return a.g.name.localeCompare(b.g.name, undefined, { numeric: true, sensitivity: "base" }) * dir || a.g.sn - b.g.sn;
    });
  }, [items, q, sortBy, asc]);
  const total = items.reduce((t, x) => t + x.n, 0);

  return (
    <div className="mb-2 shrink-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5 text-xs">
        <span className="font-semibold">Parts not nested yet</span>
        <span className="tabular-nums text-muted-foreground">{items.length} parts · {total} pcs</span>
        <div className="relative ml-2">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part"
            className="h-7 w-40 rounded-md border border-input bg-card pl-6 pr-6 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Clear search">×</button>
          )}
        </div>
        <label className="ml-1 flex items-center gap-1 text-muted-foreground">
          Sort by
          <select
            value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "left" | "size")}
            className="h-7 rounded-md border border-input bg-card px-1 text-xs text-foreground"
          >
            <option value="name">Name</option>
            <option value="left">Qty left</option>
            <option value="size">Size</option>
          </select>
        </label>
        <button
          type="button" onClick={() => setAsc((v) => !v)}
          className="flex h-7 items-center gap-1 rounded-md border border-input bg-card px-2 text-xs hover:bg-muted"
          title="Toggle ascending / descending"
        >
          {asc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />} {asc ? "Ascending" : "Descending"}
        </button>
        <span className="ml-auto text-muted-foreground">Press a part, drag it onto the sheet and release (or click, then click on the sheet)</span>
      </div>
      <div className="flex gap-0 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
        {list.length === 0 && <div className="p-3 text-xs text-muted-foreground">No part matches “{q}”.</div>}
        {list.map(({ g, n }) => (
          <button
            key={g.id}
            type="button"
            disabled={running}
            onPointerDown={(e) => onHold(g, e)}
            title={`Part #${g.sn} ${g.name} — ${n} of ${g.qty} left to nest`}
            style={{ touchAction: "none" }}
            className="flex w-[128px] shrink-0 cursor-grab select-none flex-col items-stretch gap-0.5 border-r border-border px-2 pb-1.5 pt-1 text-left hover:bg-primary/10 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="truncate text-xs font-semibold">#{g.sn} {g.name}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              <span className="font-semibold text-primary">{n}</span> of {g.qty} left
            </span>
            <span className="mt-0.5 flex h-[76px] items-center justify-center rounded border border-border/60 bg-muted/30">
              <StripThumb g={g} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
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

/** Angle readout for the part (or carried block) being held on this sheet, or null. */
function angleBadge(sheet: Sheet, sel: Sel | null, ms: MultiSel | null): { deg: number; x: number; y: number; snap: boolean } | null {
  let items: Item[] = [];
  if (sel && sheet.items.includes(sel.it)) items = [sel.it];
  else if (!sel && ms?.carry && ms.drag && ms.sh === sheet) items = ms.items;
  if (!items.length) return null;
  const bs = items.map((it) => bbox(sides(it).o));
  const deg = items[0].rot;
  return {
    deg,
    x: (Math.min(...bs.map((q) => q[0])) + Math.max(...bs.map((q) => q[2]))) / 2,
    y: Math.max(...bs.map((q) => q[3])),
    snap: isDetent(deg),
  };
}

function SheetCanvas({ sheet, index, S, width, selRef, version, heldIdx, dragRef, multiRef, selectMode, onChange }: SheetCanvasProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const k = width / S.W;
  const h = Math.ceil(S.H * k);
  const holdingHere = heldIdx === index;
  const raf = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const boxRef = React.useRef<{ x0: number; y0: number; x1: number; y1: number; cross: boolean } | null>(null);
  const gesture = React.useRef<Gesture | null>(null);
  const lastWheel = React.useRef(0);

  const paint = React.useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const ms = multiRef.current;
    drawSheet(sheet, cv, k, S, selRef.current?.it ?? null, !!selRef.current?.bad, {
      sel: ms && ms.sh === sheet ? new Set(ms.items) : null,
      selBad: !!ms?.drag?.bad,
      box: boxRef.current,
      angle: angleBadge(sheet, selRef.current, ms),
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
      const cm = multiRef.current;
      if (!selRef.current && cm?.carry && cm.drag) {
        // carrying a block: the wheel turns the whole block (5° per notch, Shift = 1°)
        e.preventDefault();
        const t = performance.now();
        if (t - lastWheel.current < 30) return;
        lastWheel.current = t;
        if (rotateGroupSnap(cm, S, ((e.deltaY || e.deltaX) > 0 ? 1 : -1) * (e.shiftKey ? 1 : 5))) angleClick(cm.items[0].rot);
        onChange();
        return;
      }
      const s = selRef.current;
      if (!s) return;
      e.preventDefault();
      const t = performance.now();
      if (t - (s.lw || 0) < 30) return;
      s.lw = t;
      // free rotation: 5° per notch, hold Shift for 1° fine steps (Shift+wheel may arrive as deltaX)
      const dy = e.deltaY || e.deltaX;
      if (rotateSnap(s, S, (dy > 0 ? 1 : -1) * (e.shiftKey ? 1 : 5))) angleClick(s.it.rot);
      onChange();
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [S, selRef, multiRef, onChange]);

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
        if (!ms.carry) ms.home = undefined;
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
              ms.home = { sh: ms.sh, pos: ms.items.map((q) => [q.x, q.y] as Pt), rot: ms.items.map((q) => q.rot) };
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
        if (cm?.carry && cm.drag && cm.sh !== sheet) {
          // pointer is over another sheet: the whole group jumps there if it fits (same thickness/material)
          if (transferGroup(cm, S, sheet, index, mm(e))) onChange();
          return;
        }
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
          // click = drop the carried group where it is; refused while it is red (rotated into no room)
          if (cm.drag?.bad) return;
          cm.carry = false;
          cm.drag = undefined;
          cm.home = undefined;
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
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // ---- box selection (CAD style): parts selected together on one sheet, moved as a group
  const multiRef = React.useRef<MultiSel | null>(null);
  const [multiCount, setMultiCount] = React.useState(0);
  const [carrying, setCarrying] = React.useState(false);
  const [carryBad, setCarryBad] = React.useState(false); // carried block rotated into no room (red)
  const [angleSound, setAngleSound] = React.useState(true); // click + vibration at every 45° while rotating
  React.useEffect(() => setAngleFeedback(angleSound), [angleSound]);
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
  // undo / redo of hand edits; starts over whenever a new nest result appears (optimise, reset, open a saved nest)
  const histRef = React.useRef<NestHistory>(resetHistory(null));
  const [hist, setHist] = React.useState<{ res: OptResult | null; undo: boolean; redo: boolean }>({ res: null, undo: false, redo: false });
  React.useEffect(() => {
    histRef.current = resetHistory(result);
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
    setCarryBad(!!multiRef.current?.drag?.bad);
    if (r?.manual && !selRef.current) syncUnplaced(r, groupsRef.current);
    // remember the nest as an undo step once it is idle again (nothing in hand, no group mid-drag)
    if (r && !selRef.current && !multiRef.current?.drag && !multiRef.current?.carry) record(histRef.current, r);
    setHist((p) => {
      const h = histRef.current;
      const u = canUndo(h);
      const rd = canRedo(h);
      return p.res === r && p.undo === u && p.redo === rd ? p : { res: r, undo: u, redo: rd };
    });
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

  // Fullscreen: one sheet at a time fills the window (index into result.sheets, null = normal page)
  const [fsIdx, setFsIdx] = React.useState<number | null>(null);
  const fsBoxRef = React.useRef<HTMLDivElement | null>(null);
  const [fsWidth, setFsWidth] = React.useState(1000);
  const sheetCount = result?.sheets.length ?? 0;
  const fs = fsIdx !== null && fsIdx < sheetCount ? fsIdx : null; // a deleted sheet closes it

  // How the sheets are shown on the page: all stacked under each other, or a TruTops-style strip of sheet
  // pictures with only the selected sheet open below it (remembered between visits).
  const [sheetView, setSheetViewRaw] = React.useState<"stack" | "strip">(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem("nest-sheet-view") === "strip" ? "strip" : "stack";
    } catch {
      return "stack";
    }
  });
  const setSheetView = (v: "stack" | "strip") => {
    setSheetViewRaw(v);
    try {
      window.localStorage.setItem("nest-sheet-view", v);
    } catch {
      /* private mode etc. — just don't remember */
    }
  };
  const [activeSheet, setActiveSheet] = React.useState(0);
  const act = Math.min(activeSheet, Math.max(0, sheetCount - 1));
  React.useEffect(() => {
    if (fs !== null) setActiveSheet(fs); // leaving fullscreen on another sheet keeps that sheet open
  }, [fs]);

  React.useEffect(() => {
    if (fs === null) return;
    const el = fsBoxRef.current;
    if (!el) return;
    const upd = () => setFsWidth(Math.max(300, el.clientWidth));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind must not scroll
    // Esc leaves fullscreen only when it isn't already cancelling a held part / selection
    const onKey = (e: KeyboardEvent) => {
      if (selRef.current || multiRef.current) return; // then the keys belong to the held part / selection
      if (e.key === "Escape") {
        setFsIdx(null);
        return;
      }
      // arrows switch between sheets (only when nothing is held or selected, so nudging parts still works)
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
      if (!step || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select")) return;
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      e.preventDefault();
      setFsIdx((c) => (c === null ? c : Math.min(sheetCount - 1, Math.max(0, c + step))));
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      ro.disconnect();
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [fs, sheetCount]);

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

  /**
   * Rotates the box-selected parts as one block (90° from the button / R key, 5° per wheel notch while carrying it).
   * While carrying, rotation is never blocked (the block goes red until it is moved to a free spot). Not carrying,
   * it only turns in place when it fits; otherwise it is left as it was.
   */
  const rotateSelection = React.useCallback(
    (d: number) => {
      const ms = multiRef.current;
      if (!ms || !resS || selRef.current) return;
      if (ms.carry && ms.drag) {
        rotateGroup(ms, resS, d);
        bump();
        return;
      }
      if (ms.drag) return;
      const before = ms.items.map((q) => ({ x: q.x, y: q.y, rot: q.rot }));
      startGroupDrag(ms, resS, [0, 0]);
      rotateGroup(ms, resS, d);
      const dr = ms.drag as MultiSel["drag"]; // startGroupDrag / rotateGroup just (re)created it
      if (dr?.bad) {
        ms.items.forEach((q, i) => Object.assign(q, before[i]));
        toast.warning("No room to rotate the block here — double-click it to pick it up, rotate, and drop it in free space");
      }
      ms.drag = undefined;
      bump();
    },
    [resS, bump],
  );

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

  function openSavedNest(n: SavedNest, sheetIdx = 0) {
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
    setActiveSheet(sheetIdx); // used by the "Sheet strip" view
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

  /** Ctrl+Z / Ctrl+Y (also the buttons): step through hand edits of the nest. Not while something is in hand. */
  const stepHistory = React.useCallback(
    (dir: "undo" | "redo") => {
      const r = resultRef.current;
      if (!r || selRef.current || multiRef.current?.drag || multiRef.current?.carry) return;
      if (!(dir === "undo" ? undo : redo)(histRef.current, r)) return;
      multiRef.current = null;
      bump();
    },
    [bump],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // let text fields keep their own undo
      if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        stepHistory("undo");
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        stepHistory("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepHistory]);

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
        if (e.key === "r" || e.key === "R") {
          rotateSelection(90);
          return;
        }
        // S while several parts are being moved together: the one under the pointer stays in hand, the rest go back
        if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey && ms.drag && ms.items.length > 1) {
          e.preventDefault();
          if (separateGroup(ms, resS)) {
            toast.info("Separated — the other part(s) went back to their last position");
            bump();
          }
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
  }, [resS, bump, removeHeld, removeSelected, rotateSelection]);

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

  // selection / held-part bar (shown in the page and, while a sheet is fullscreen, above that sheet)
  // sheet settings fields — shared by the page card and the full-screen settings popup
  const settingsGrid = (
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
  );

  const actionBar = (
          <div className="mb-2 min-h-[6.5rem]">
          {!held && multiCount > 0 && (
            <div className="flex min-h-[6.5rem] flex-wrap content-start items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/5 p-2">
              <span className="text-xs font-medium">{multiCount} part{multiCount > 1 ? "s" : ""} selected</span>
              {!carrying && (
                <Button variant="outline" size="sm" className="text-destructive" onClick={removeSelected} title="Take the selected parts off the sheet (Delete key)">
                  <Undo2 /> Put back to list
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => rotateSelection(90)} title="Rotate the whole selection 90° as one block (R key)">
                <RotateCcw /> Rotate block 90°
              </Button>
              {carrying ? (
                <>
                  <Button
                    variant="secondary" size="sm" disabled={carryBad}
                    onClick={() => { const m = multiRef.current; if (m) { m.carry = false; m.drag = undefined; m.home = undefined; } bump(); }}
                  >
                    <Check /> Place here
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {carryBad
                      ? "The block has no room here (red) — move it to a free spot to place it, or press Esc. "
                      : "Holding the whole selection — scroll the wheel to rotate it (5° per notch, Shift = 1°, R = 90°), move over this or another sheet of the same material/thickness, click to place, Esc to cancel. "}
                    It stops at other parts, the spacing and the margin.
                  </span>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { multiRef.current = null; bump(); }}>
                    Clear selection
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Drag one of them to move the whole selection, or double-click one to pick them all up — it stops at other parts, the spacing and the margin. Press S while moving to separate them: the part under the pointer stays in hand, the rest go back.
                  </span>
                </>
              )}
            </div>
          )}
          {held && (
            <div className="flex min-h-[6.5rem] flex-wrap content-start items-center gap-2 p-2">
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
            {!held && multiCount === 0 && (
              <div className="flex min-h-[6.5rem] items-center justify-center rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">
                Select parts on a sheet (drag a box) or double-click a part to pick it up — its actions appear here.
              </div>
            )}
          </div>
  );

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
          {settingsGrid}
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
                variant="outline" size="sm"
                onClick={() => stepHistory("undo")}
                disabled={running || !!held || carrying || !(hist.res === result && hist.undo)}
                title="Undo the last change to the nest (Ctrl+Z)"
              >
                <Undo2 /> Undo
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => stepHistory("redo")}
                disabled={running || !!held || carrying || !(hist.res === result && hist.redo)}
                title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
              >
                <Redo2 /> Redo
              </Button>
              <Button
                variant={selectMode ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectMode((v) => !v)}
                title="Touch screens: when on, dragging on a sheet draws a selection box instead of scrolling the page"
              >
                Touch select {selectMode ? "on" : "off"}
              </Button>
              <Button
                variant={angleSound ? "default" : "outline"}
                size="sm"
                onClick={() => setAngleSound((v) => !v)}
                title="Rotation stops with a click (and a vibration on phones) at every 45° — 0, 45, 90, 135 ... — and the angle badge turns green"
              >
                Angle click {angleSound ? "on" : "off"}
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
            selection). Then drag any selected part to move them all together, or double-click one to pick them all up and click to place; S while moving them separates: the part under the pointer stays in your hand and the others go back to their last position; R rotates the whole selection as a block (arrow keys move one grid cell, Delete puts them back to the list, Esc clears).
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            Double-click a part to pick it up: it follows the mouse (move it onto another sheet of the same thickness to
            transfer it), scroll the wheel to rotate freely (5° per notch, hold Shift for 1°; R = 90°) — it stops with a click at every 45° (0, 45, 90, 135 ...) and the angle badge turns green — click to place, Esc to cancel. While moving, it can&apos;t overlap other parts,
            break the spacing, or enter the margin (it stays at the last allowed position). Rotation is never blocked: if there&apos;s no room the part
            turns anyway and goes red — drag it to a free spot to place it.
          </p>
          {/* fixed-height slot: the selection / held-part bar appears here without pushing the sheets down */}
          {actionBar}
          {result && resS && (
            <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
              Sheet view
              <Button variant={sheetView === "stack" ? "default" : "outline"} size="sm" className="h-7" onClick={() => setSheetView("stack")} title="Show every sheet under each other">
                All sheets
              </Button>
              <Button variant={sheetView === "strip" ? "default" : "outline"} size="sm" className="h-7" onClick={() => setSheetView("strip")} title="Show a strip of sheet pictures (like TruTops) and open one sheet at a time">
                Sheet strip
              </Button>
            </div>
          )}
          {result && resS && sheetView === "strip" && (
            <SheetStrip
              sheets={result.sheets} S={resS} version={version} active={act}
              onSelect={setActiveSheet}
              canAdd={!running && !!lots.length}
              onAdd={() => {
                const n = sheetCount;
                addSheet();
                setActiveSheet(n);
              }}
            />
          )}
          <div ref={boxRef} className="space-y-4">
            {!result || !resS ? (
              <p className="text-sm text-muted-foreground">Import parts, then press Optimize — or press a part in the table to nest it by hand.</p>
            ) : (
              result.sheets.map((sh, i) => {
                if (sheetView === "strip" && fs !== i && i !== act) return null; // strip mode: only the selected sheet is open
                const st = sheetStats(sh, resS);
                const node = (
                  <div key={i} className={fs === i ? "fixed inset-0 z-[45] flex h-dvh flex-col overflow-hidden bg-background p-3" : undefined}>
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
                      <span className="inline-flex items-center gap-0.5">
                        <span className="text-xs text-muted-foreground">Fit to parts:</span>
                        {([
                          ["width", "Width", "Trim only the sheet width (W) down to its parts; the height stays as it is"],
                          ["height", "Height", "Trim only the sheet height (H) down to its parts; the width stays as it is"],
                          ["both", "Both", "Trim both width and height down to its parts, to cut less material / less scrap"],
                        ] as const).map(([dir, label, tip]) => (
                          <Button
                            key={dir}
                            variant="ghost" size="sm" className="h-7 px-2"
                            title={tip}
                            onClick={() => {
                              fitSheetToParts(sh, resS, dir);
                              bump();
                            }}
                          >
                            {label}
                          </Button>
                        ))}
                      </span>
                      {fs === i && (
                        <span className="inline-flex items-center gap-1">
                          <Button
                            size="sm" className="h-7"
                            disabled={running || !groups.length || !!held}
                            title="Run the optimiser (uses the settings from the page)"
                            onClick={() => (result?.manual && result.sheets.some((x) => x.items.length) ? setConfirmOptimize(true) : start())}
                          >
                            {running ? <Loader2 className="animate-spin" /> : <Layers />} Optimize nest
                          </Button>
                          <Button variant="secondary" size="sm" className="h-7" disabled={!running} onClick={() => (stopRef.current = true)}>
                            Stop
                          </Button>
                          <Button variant="outline" size="sm" className="h-7" onClick={() => setSettingsOpen(true)} title="Sheet size, margin, spacing, rotation and optimize time">
                            <SlidersHorizontal /> Settings
                          </Button>
                          <Button variant="outline" size="sm" className="h-7" disabled={!canExport || !!held} onClick={saveNest} title="Keep this nest so you can try another one and compare them">
                            <Save /> Save nest
                          </Button>
                          {status && <span className="max-w-[28ch] truncate" title={status}>{status}</span>}
                        </span>
                      )}
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
                      {fs === i && result.sheets.length > 1 && (
                        <span className="ml-auto inline-flex items-center gap-1">
                          <Button variant="outline" size="sm" className="h-7 px-2" disabled={i === 0} title="Previous sheet (← / ↑)" onClick={() => setFsIdx(i - 1)}>
                            <ChevronLeft />
                          </Button>
                          <span className="tabular-nums">{i + 1} / {result.sheets.length}</span>
                          <Button variant="outline" size="sm" className="h-7 px-2" disabled={i === result.sheets.length - 1} title="Next sheet (→ / ↓)" onClick={() => setFsIdx(i + 1)}>
                            <ChevronRight />
                          </Button>
                        </span>
                      )}
                      <Button
                        variant="ghost" size="sm" className={fs === i && result.sheets.length > 1 ? "h-7" : "ml-auto h-7"}
                        title={fs === i ? "Back to the page (Esc)" : "Fill the whole window with this sheet"}
                        onClick={() => setFsIdx(fs === i ? null : i)}
                      >
                        {fs === i ? <Minimize2 /> : <Maximize2 />} {fs === i ? "Exit full screen" : "Full screen"}
                      </Button>
                    </div>
                    {fs === i && <div className="mb-2 shrink-0">{actionBar}</div>}
                    {fs === i && stillToPlace.length > 0 && (
                      <UnplacedStrip items={stillToPlace} running={running} onHold={holdFromList} />
                    )}
                    <div
                      ref={fs === i ? fsBoxRef : undefined}
                      className={fs === i ? "min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]" : undefined}
                    >
                      <SheetCanvas sheet={sh} index={i} S={resS} width={fs === i ? fsWidth : width} selRef={selRef} version={version} heldIdx={held ? held.idx : null} dragRef={dragRef} multiRef={multiRef} selectMode={selectMode} onChange={bump} />
                    </div>
                  </div>
                );
                // fullscreen is rendered straight into <body> so no parent (sidebar, transforms, overflow) can clip or cover it
                return fs === i && typeof document !== "undefined" ? createPortal(node, document.body, `fs-${i}`) : node;
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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sheet &amp; settings</DialogTitle>
            <DialogDescription>Used the next time you press Optimize nest.</DialogDescription>
          </DialogHeader>
          {settingsGrid}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSettingsOpen(false)}>Close</Button>
            <Button
              disabled={running || !groups.length || !!held}
              onClick={() => {
                setSettingsOpen(false);
                if (result?.manual && result.sheets.some((x) => x.items.length)) setConfirmOptimize(true);
                else void start();
              }}
            >
              <Layers /> Optimize nest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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