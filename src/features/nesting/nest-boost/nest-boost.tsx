"use client";
import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Circle as CircleIcon, Copy, Download, FileSpreadsheet, FolderInput, Layers, Loader2, Maximize2, Minimize2, Plus, Redo2, RotateCcw, Save, Search, Shapes, Square, SlidersHorizontal, Trash2, Triangle as TriangleIcon, TriangleAlert, Undo2, Upload } from "lucide-react";
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
import { decodeSnapshot, encodeSnapshot } from "./persist";
import { AutosaveBadge, useNestingAutosave } from "../use-nesting-autosave";
import {
  addFileParts,
  addManualPart,
  buildManualShape,
  manualPartName,
  resizeGroup,
  addNestParts,
  splitNestLoops,
  thicknessFromName,
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
  canContinueOn,
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
  type ManualShape,
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
  /** True when the sheet is shown full screen: the parent box is then the scroll container while zoomed. */
  fullscreen?: boolean;
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
/** Upper bound for the canvas back-buffer so huge zoom levels can never exhaust GPU / canvas memory. */
const MAX_SIDE_PX = 16000;
const MAX_AREA_PX = 28e6;

function SheetCanvas({ sheet, index, S, width, selRef, version, heldIdx, dragRef, multiRef, selectMode, fullscreen, onChange }: SheetCanvasProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // --- hover readout + measure tool ---------------------------------------------------------------
  type HoverInfo = { sn: number; name: string; w: number; h: number; rot: number; area: number };
  const [hover, setHover] = React.useState<HoverInfo | null>(null);
  const [measureOn, setMeasureOn] = React.useState(false);
  const measureRef = React.useRef<{ a: Pt; b: Pt; done: boolean } | null>(null);
  const lastHover = React.useRef(0);
  const overRef = React.useRef(false);

  // --- zoom (Alt + wheel) -------------------------------------------------------
  const [zoom, setZoomState] = React.useState(1);
  const zoomRef = React.useRef(1);
  const cssW = width * zoom; // size on screen, in CSS px
  const cssH = Math.ceil(S.H * (width / S.W)) * zoom;
  // Render at (at least) 2x the screen pixels so lines and text stay sharp, even on 1x monitors and when
  // zoomed; capped so the back-buffer stays within what browsers can allocate.
  const devDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const ratio = Math.max(
    0.5,
    Math.min(Math.max(devDpr, 2), MAX_SIDE_PX / cssW, MAX_SIDE_PX / cssH, Math.sqrt(MAX_AREA_PX / (cssW * cssH))),
  );
  const k = (cssW / S.W) * ratio; // back-buffer pixels per mm
  const h = Math.ceil(S.H * k);
  const bufW = Math.round(cssW * ratio);
  const getScroller = React.useCallback(
    () => (fullscreen ? scrollRef.current?.parentElement?.parentElement : scrollRef.current) ?? null,
    [fullscreen],
  );
  const setZoomAt = React.useCallback(
    (next: number, cx?: number, cy?: number) => {
      const cv = ref.current;
      const sc = getScroller();
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const oz = zoomRef.current;
      if (!cv || !sc || Math.abs(nz - oz) < 1e-4) return;
      const r = cv.getBoundingClientRect();
      const sr = sc.getBoundingClientRect();
      // keep the point under the cursor (default: centre of the visible area) fixed on screen
      const px = cx ?? sr.left + sc.clientWidth / 2;
      const py = cy ?? sr.top + sc.clientHeight / 2;
      const fx = (px - r.left) / r.width;
      const fy = (py - r.top) / r.height;
      const offX = r.left - sr.left + sc.scrollLeft;
      const offY = r.top - sr.top + sc.scrollTop;
      zoomRef.current = nz;
      flushSync(() => setZoomState(nz));
      const ratioNew = nz / oz;
      sc.scrollLeft = offX + fx * r.width * ratioNew - (px - sr.left);
      sc.scrollTop = offY + fy * r.height * ratioNew - (py - sr.top);
    },
    [getScroller],
  );
  const resetZoom = React.useCallback(() => {
    zoomRef.current = 1;
    setZoomState(1);
    const sc = getScroller();
    if (sc) {
      sc.scrollLeft = 0;
      sc.scrollTop = 0;
    }
  }, [getScroller]);
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
      dpr: ratio,
      measure: measureRef.current,
    });
  }, [sheet, k, S, selRef, multiRef, ratio]);

  // layout effect: the resized back-buffer is repainted before the browser shows it (no blank flash while zooming)
  React.useLayoutEffect(() => {
    paint();
  }, [paint, h, bufW, version]);

  // Keyboard (only while the pointer is over this sheet): M = measure tool on/off, Ctrl+0 = reset zoom
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!overRef.current) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setMeasureOn((v) => !v);
        measureRef.current = null;
        setHover(null);
        requestAnimationFrame(paint);
      } else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paint, resetZoom]);

  // Esc while drawing a selection box cancels the box
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && measureRef.current) {
        measureRef.current = null;
        paint();
        return;
      }
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
      if (e.altKey) {
        // Alt + wheel zooms the sheet, not the page
        e.preventDefault();
        const rawDy = e.deltaY || e.deltaX;
        const dy = e.deltaMode === 1 ? rawDy * 33 : rawDy;
        setZoomAt(zoomRef.current * Math.exp(-dy * 0.002), e.clientX, e.clientY);
        return;
      }
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
  }, [S, selRef, multiRef, onChange, setZoomAt]);

  // middle mouse button drags the zoomed sheet around
  const panStart = React.useRef<{ x: number; y: number; l: number; t: number } | null>(null);

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

  /** Point for the measure tool: snaps to the nearest part-box corner / edge middle within ~10 screen px. */
  const snapPt = (m: Pt): Pt => {
    const tol = 10 / (cssW / S.W);
    let best: Pt = m;
    let bd = tol;
    for (const it of sheet.items) {
      const b = bbox(sides(it).o);
      const xs = [b[0], (b[0] + b[2]) / 2, b[2]];
      const ys = [b[1], (b[1] + b[3]) / 2, b[3]];
      for (const x of xs) for (const y of ys) {
        const d = Math.hypot(x - m[0], y - m[1]);
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    return best;
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
    <div className="relative">
    <div
      ref={scrollRef}
      className={fullscreen ? undefined : "overflow-auto [scrollbar-gutter:stable]"}
      style={fullscreen ? undefined : { maxHeight: "80vh" }}
    >
      <canvas
        ref={ref}
        width={bufW}
        height={h}
        data-sheet-index={index}
        className="block max-w-none select-none rounded border border-border bg-card"
        style={{
          width: cssW,
          height: cssH,
          touchAction: holdingHere || selectMode ? "none" : "auto",
          cursor: measureOn ? "crosshair" : heldIdx !== null ? "move" : "default",
        }}
        onAuxClick={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button === 1) {
            const sc = getScroller();
            if (!sc) return;
            e.preventDefault();
            panStart.current = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop };
            const move = (ev: PointerEvent) => {
              const p = panStart.current;
              if (!p) return;
              sc.scrollLeft = p.l - (ev.clientX - p.x);
              sc.scrollTop = p.t - (ev.clientY - p.y);
            };
            const up = () => {
              panStart.current = null;
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            return;
          }
          if (measureOn && e.button === 0) {
            const m = snapPt(mm(e));
            const cur = measureRef.current;
            measureRef.current = !cur || cur.done ? { a: m, b: m, done: false } : { a: cur.a, b: m, done: true };
            paint();
            return;
          }
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
          if (measureOn) return;
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
        onPointerEnter={() => { overRef.current = true; }}
        onPointerLeave={() => { overRef.current = false; setHover(null); }}
        onPointerMove={(e) => {
          if (measureOn) {
            const cur = measureRef.current;
            if (cur && !cur.done) {
              measureRef.current = { a: cur.a, b: snapPt(mm(e)), done: false };
              paint();
            }
            return;
          }
          if (!gesture.current && !selRef.current && !multiRef.current?.carry) {
            const t = performance.now();
            if (t - lastHover.current > 40) {
              lastHover.current = t;
              const it = partAt(mm(e));
              if (!it) setHover(null);
              else {
                const b = bbox(sides(it).o);
                const next = { sn: it.g.sn, name: it.g.name, w: b[2] - b[0], h: b[3] - b[1], rot: it.rot, area: it.g.area };
                setHover((p) => (p && p.sn === next.sn && Math.abs(p.w - next.w) < 1e-6 && Math.abs(p.h - next.h) < 1e-6 && p.rot === next.rot ? p : next));
              }
            }
          } else setHover(null);
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
    </div>
    <div className="sticky bottom-0 z-10 flex h-5 items-center gap-3 bg-card/90 px-1 text-[11px] tabular-nums text-muted-foreground">
      {measureOn ? (
        <span>Measure (M to exit): click a start point, then an end point. Esc clears.</span>
      ) : hover ? (
        <>
          <span className="font-semibold text-foreground">#{hover.sn}</span>
          <span className="truncate">{hover.name}</span>
          <span>{hover.w.toFixed(1)} × {hover.h.toFixed(1)} mm</span>
          {hover.rot % 360 !== 0 && <span>rot {Math.round(hover.rot * 10) / 10}°</span>}
          <span>area {Math.round(hover.area).toLocaleString()} mm²</span>
        </>
      ) : (
        <span className="opacity-60">Hover a part to see its size · Alt+scroll zoom · M measure</span>
      )}
    </div>
    </div>
  );
}

// mm-per-unit for the unit label the server-side DXF parser detected.
const UNIT_SCALE: Record<string, number> = { in: 25.4, ft: 304.8, mm: 1, cm: 10, m: 1000, "µm": 0.001, dm: 100 };

/**
 * Sheet cut-size field: you can type a whole number freely; it is applied (and clamped to what the parts need /
 * the stock sheet size) only on Enter or when the field loses focus. Esc cancels.
 */
function CutSizeInput({ value, max, onCommit }: { value: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    const v = Number(draft);
    setDraft(null);
    if (draft !== null && Number.isFinite(v) && v > 0 && Math.round(v) !== value) onCommit(v);
  };
  return (
    <Input
      type="number"
      min={1}
      max={max}
      className="h-7 w-20"
      title={`Smaller than the stock sheet (max ${max}) and not smaller than the parts need. Press Enter to apply.`}
      value={draft ?? value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** lucide has no trapezoid, so this one is drawn the same way (24×24, 2px outline). */
function TrapezoidIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M7 5h10l4 14H3z" />
    </svg>
  );
}

/**
 * Length / width field of a part: type freely, the new size is applied on Enter or when the field loses focus
 * (so half-typed numbers never rescale the part). Esc cancels.
 */
function DimInput({ value, onCommit, label, className = "" }: { value: number; onCommit: (v: number) => void; label: string; className?: string }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = String(Math.round(value * 100) / 100);
  const commit = () => {
    const v = Number(draft);
    const d = draft;
    setDraft(null);
    if (d !== null && d.trim() !== "" && Number.isFinite(v) && v > 0 && Math.abs(v - value) >= 0.005) onCommit(v);
  };
  return (
    <Input
      type="number"
      min={0}
      step="any"
      aria-label={label}
      title={`${label} (mm) — press Enter to apply`}
      className={`h-8 w-full min-w-16 md:w-24 ${className}`}
      value={draft ?? shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Form of the "Add part by dimensions" popup (everything is text so the fields can be empty while typing). */
type ManualForm = {
  kind: ManualShape["kind"];
  w: string; h: string; // rectangle
  a: string; b: string; angle: string; // triangle
  tzA: string; tzB: string; tzH: string; tzRight: boolean; // trapezoid: bottom base, top base, height, one side at 90°
  d: string; // circle
  hasHole: boolean; hole: string;
  th: string; material: string; qty: string; name: string;
};
const EMPTY_MANUAL: ManualForm = {
  kind: "rect", w: "", h: "", a: "", b: "", angle: "90", tzA: "", tzB: "", tzH: "", tzRight: false, d: "", hasHole: false, hole: "", th: "", material: "", qty: "1", name: "",
};

/** One line of the "what will be added" popup that opens after choosing DXF files. */
type ImportPreviewRow = { g: Group; file: string; status: "new" | "merged"; add: number };
type ImportPreview = {
  scale: number;
  files: { f: File; r: ReturnType<typeof parseDXF> }[];
  rows: ImportPreviewRow[];
};

export function NestBoost() {
  const { projectId, nestingQueue, clearNestingQueue, ensureWorkspace, consumeFresh, workspaceId, workspaceLabel } = useTakeoffProject();
  const [reporting, setReporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  // Files chosen but not added yet: the popup lists every part they contain; "Add" puts them in the list.
  const [pendingImport, setPendingImport] = React.useState<ImportPreview | null>(null);
  // Rows added / increased by the last import, highlighted in the parts table for a few seconds.
  const [newIds, setNewIds] = React.useState<Set<number>>(new Set());
  // Filters of the "Parts & quantities" list ("" = no filter on that column)
  const [fFile, setFFile] = React.useState("");
  const [fTh, setFTh] = React.useState("");
  const [fMat, setFMat] = React.useState("");
  const [fLeft, setFLeft] = React.useState<"" | "left" | "done">("");
  const newIdsTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Editing a part's length / width: with "keep proportions" on, changing one changes the other too.
  const [keepRatio, setKeepRatio] = React.useState(true);
  const [pendingResize, setPendingResize] = React.useState<{ id: number; w: number; h: number } | null>(null);
  // "Add part by dimensions" popup
  const [manualOpen, setManualOpen] = React.useState(false);
  const [mf, setMf] = React.useState<ManualForm>(EMPTY_MANUAL);
  const [confirmOptimize, setConfirmOptimize] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // What "Optimize nest" does when a nest already exists: rebuild everything, or only nest the pieces not placed yet
  const [nestMode, setNestMode] = React.useState<"scratch" | "fill" | "new">("scratch");
  const [soloFill, setSoloFill] = React.useState(true);
  // "Nest this part alone": the part + its own settings (spacing, margin, rotation ...), chosen in a popup
  const [solo, setSolo] = React.useState<{ g: Group; c: typeof cfg } | null>(null);
  const [soloOpen, setSoloOpen] = React.useState(false);
  const [confirmSolo, setConfirmSolo] = React.useState(false);
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

  const unclosedWarning = (name: string, n: number) =>
    `\n⚠ ${name}: ${n} part(s) could NOT be imported — their lines don't close into a contour. Duplicate / overlapping lines and small tails past a corner are cleaned up automatically, so this is a real gap or a missing line.` +
    `\n   Fix in AutoCAD: close the gap (JOIN / PEDIT), save the DXF and import it again.\n`;

  /** What adding these files would do to the parts list (nothing is changed yet, counters are copied). */
  function buildPreview(files: { f: File; r: ReturnType<typeof parseDXF> }[], scale: number): ImportPreview {
    let gs = groupsRef.current;
    const c = { ...counters.current };
    const rows: ImportPreviewRow[] = [];
    for (const { f, r } of files) {
      const before = new Map(gs.map((g) => [g.id, g.qty]));
      const added = addFileParts(gs, r.loops, f.name, scale, c, { labels: r.labels });
      for (const g of added.groups) {
        const q = before.get(g.id);
        if (q === undefined) rows.push({ g, file: f.name, status: "new", add: g.qty });
        else if (q !== g.qty) rows.push({ g, file: f.name, status: "merged", add: g.qty - q });
      }
      gs = added.groups;
    }
    return { scale, files, rows };
  }

  /** Step 1: read the chosen files and show the popup. Nothing is added (and no history entry is created) until "Add". */
  async function handleFiles(files: File[]) {
    if (!files.length) return;
    const parsedFiles: { f: File; r: ReturnType<typeof parseDXF> }[] = [];
    for (const f of files) parsedFiles.push({ f, r: parseDXF(await f.text()) });
    setPendingImport(buildPreview(parsedFiles, +units));
  }

  /** Step 2: the "Add" button of the popup. */
  async function confirmImport() {
    const pi = pendingImport;
    if (!pi) return;
    setPendingImport(null);
    const parsedFiles = pi.files;
    // Nothing open: the import starts a new entry in the user's history (name + date), auto-saved from now on.
    if (!workspaceId && parsedFiles.some((x) => x.r.loops.length)) {
      try {
        const first = parsedFiles.find((x) => x.r.loops.length)!.f.name.replace(/\.dxf$/i, "");
        await ensureWorkspace(parsedFiles.length > 1 ? `${first} +${parsedFiles.length - 1}` : first);
      } catch (err) {
        toast.error(`${err instanceof Error ? err.message : "Could not save this import to your history"} — it will not be auto-saved`);
      }
    }
    let gs = groupsRef.current;
    let text = "";
    let total = 0;
    const touched: number[] = [];
    for (const { f, r } of parsedFiles) {
      const before = new Map(gs.map((g) => [g.id, g.qty]));
      const added = addFileParts(gs, r.loops, f.name, pi.scale, counters.current, { labels: r.labels });
      for (const g of added.groups) if (before.get(g.id) !== g.qty) touched.push(g.id);
      gs = added.groups;
      total += added.count;
      text +=
        `${f.name}: ${r.loops.length} contours → ${added.count} part(s)` +
        (r.labels.length ? ` (quantity / thickness read from the drawing's QTY / thk notes for ${added.labelled} part(s))` : "") +
        (r.skip.length ? ` (unsupported/approximated: ${r.skip.join(", ")})` : "") +
        "\n";
    }
    setG(gs);
    const bad = parsedFiles.filter((x) => x.r.unclosed.length);
    for (const { f, r } of bad) text += unclosedWarning(f.name, r.unclosed.length);
    setMsg(text);
    if (touched.length) {
      toast.success(`Added ${total} part(s) from ${parsedFiles.length} file(s) — highlighted in the list`);
      // highlight what changed and scroll to the first new row
      setNewIds(new Set(touched));
      if (newIdsTimer.current) clearTimeout(newIdsTimer.current);
      newIdsTimer.current = setTimeout(() => setNewIds(new Set()), 8000);
      // the new rows may be hidden by a filter: show everything so the person sees what was added
      setFFile("");
      setFTh("");
      setFMat("");
      setFLeft("");
      setTimeout(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-part-row="${touched[0]}"]`));
        els.find((el) => el.offsetParent !== null)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
    if (bad.length) toast.warning(`${bad.reduce((n, x) => n + x.r.unclosed.length, 0)} part(s) were NOT imported — their outline has a gap (see the message on the left)`, { duration: 12000 });
  }

  /**
   * Imports a nest DXF (sheet outlines with the parts placed on them, e.g. the file exported from here):
   * every part goes into the list and the sheets are rebuilt with each part where the DXF has it.
   */
  async function handleNestFile(f: File) {
    const r = parseDXF(await f.text());
    const nest = splitNestLoops(r.loops, +units);
    if (!nest.sheets.length) {
      toast.error("No sheets found — a nest DXF needs a rectangle for each sheet with the parts inside it.");
      return;
    }
    let th = r.labels.find((l) => l.th && l.th > 0)?.th ?? thicknessFromName(f.name);
    if (!th) {
      const a = window.prompt("Plate thickness (mm) of this nest? (the file has no 'thk: n' note or '8mm' in its name)", "");
      if (a === null) return;
      th = Number(a.replace(",", ".")) || 0;
    }
    const maxW = Math.round(Math.max(...nest.sheets.map((x) => x.W)));
    const maxH = Math.round(Math.max(...nest.sheets.map((x) => x.H)));
    // with a nest already open the new sheets are added to it (they must fit its sheet size); otherwise the sheet size follows the file
    const cur = resultRef.current && resS ? resS : null;
    if (cur && (maxW > cur.W + 0.5 || maxH > cur.H + 0.5)) {
      toast.error(`The sheets in this file (${maxW}×${maxH}) are bigger than the sheet size of the current nest (${cur.W}×${cur.H}). Reset the nest first.`);
      return;
    }
    const c = cur ? cfg : { ...cfg, W: String(maxW), H: String(maxH) };
    const S = cur ?? readSettings(c);
    if (!S) {
      toast.error("Check the sheet settings (length, width, margin, spacing).");
      return;
    }
    if (!workspaceId) {
      try {
        await ensureWorkspace(f.name.replace(/\.dxf$/i, ""));
      } catch (err) {
        toast.error(`${err instanceof Error ? err.message : "Could not save this import to your history"} — it will not be auto-saved`);
      }
    }
    const added = addNestParts(groupsRef.current, nest.sheets, f.name, counters.current, { th, material: "" });
    if (!cur) setCfg(c);
    const res = manualResult(S);
    res.sheets.push(...added.sheets);
    res.manual = true;
    setG(added.groups);
    syncUnplaced(res, added.groups);
    bump();
    setMsg(
      `${f.name}: ${added.sheets.length} sheet(s), ${added.count} part(s) in ${added.groups.length} row(s)` +
        (th ? ` — ${th} mm` : " — thickness unknown, set it in the parts list") +
        (nest.stray ? `\n${nest.stray} loose contour(s) outside any sheet were ignored` : "") +
        (r.unclosed.length ? unclosedWarning(f.name, r.unclosed.length) : "") +
        "\nThe nest was rebuilt exactly as drawn; parts can still be moved by hand.",
    );
    if (r.unclosed.length) toast.warning(`${r.unclosed.length} part(s) were NOT imported — their outline has a gap (see the message on the left)`, { duration: 12000 });
    else toast.success(`Imported nest: ${added.sheets.length} sheet(s), ${added.count} part(s)`);
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

  /** Adds a copy of a part right under it (same shape, size and quantity) so its thickness / material / quantity can differ. */
  const duplicatePart = (id: number) => {
    const gs = groupsRef.current;
    const i = gs.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy: Group = { ...gs[i], id: counters.current.id++, sn: ++counters.current.sn };
    setG([...gs.slice(0, i + 1), copy, ...gs.slice(i + 1)]);
    setMsg(`Part #${gs[i].sn} duplicated as #${copy.sn} — set its own thickness / material / quantity.`);
  };

  /** Highlights rows in the list (and brings the first one into view): shows the person what was just added / changed. */
  const flashRows = (ids: number[]) => {
    if (!ids.length) return;
    setFFile("");
    setFTh("");
    setFMat("");
    setFLeft("");
    setNewIds(new Set(ids));
    if (newIdsTimer.current) clearTimeout(newIdsTimer.current);
    newIdsTimer.current = setTimeout(() => setNewIds(new Set()), 8000);
    setTimeout(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-part-row="${ids[0]}"]`));
      els.find((el) => el.offsetParent !== null)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  };

  /** The person typed a new length or width for a part (`which` = the one they changed). */
  const sizeGroup = (g: Group, which: "w" | "h", v: number) => {
    if (!(v > 0)) return;
    const k = v / (which === "w" ? g.w : g.h);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const w = r2(keepRatio ? g.w * k : which === "w" ? v : g.w);
    const h = r2(keepRatio ? g.h * k : which === "h" ? v : g.h);
    if (w < 1 || h < 1 || w > 1e5 || h > 1e5) {
      toast.error("The part size must be between 1 and 100000 mm.");
      return;
    }
    if (Math.abs(w - g.w) < 0.005 && Math.abs(h - g.h) < 0.005) return;
    if ((placed.get(g.id) ?? 0) > 0) setPendingResize({ id: g.id, w, h }); // it is on the sheets: ask first
    else doResize(g.id, w, h);
  };

  const doResize = (id: number, w: number, h: number) => {
    const g = groupsRef.current.find((x) => x.id === id);
    if (!g) return;
    const wasPlaced = (placed.get(id) ?? 0) > 0;
    setG(groupsRef.current.map((x) => (x.id === id ? resizeGroup(x, w, h) : x)));
    if (wasPlaced) clearResults();
    setMsg(
      `Part #${g.sn} resized from ${g.w.toFixed(1)} × ${g.h.toFixed(1)} to ${w} × ${h} mm.` +
        (wasPlaced ? " The nest was cleared — press Optimize to re-nest." : ""),
    );
    flashRows([id]);
  };

  // ---- "Add part by dimensions"
  const mfNum = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const mfHole = mf.hasHole ? mfNum(mf.hole) : 0;
  const mfShape: ManualShape =
    mf.kind === "rect"
      ? { kind: "rect", w: mfNum(mf.w), h: mfNum(mf.h), hole: mfHole }
      : mf.kind === "circle"
        ? { kind: "circle", d: mfNum(mf.d), hole: mfHole }
        : mf.kind === "trapezoid"
          ? { kind: "trapezoid", a: mfNum(mf.tzA), b: mfNum(mf.tzB), h: mfNum(mf.tzH), right: mf.tzRight, hole: mfHole }
          : { kind: "triangle", a: mfNum(mf.a), b: mfNum(mf.b), angle: mfNum(mf.angle), hole: mfHole };
  const mfGeo = buildManualShape(mfShape);
  // show the "what is wrong" message only once something was typed
  const mfTouched = mf.w + mf.h + mf.a + mf.b + mf.d + mf.tzA + mf.tzB + mf.tzH !== "" || (mf.hasHole && mf.hole !== "");

  async function addManual(keepOpen: boolean) {
    if ("error" in mfGeo) {
      toast.error(mfGeo.error);
      return;
    }
    // Nothing open: the first part starts a new entry in the user's history, like an import does.
    if (!workspaceId) {
      try {
        await ensureWorkspace("Manual parts");
      } catch (err) {
        toast.error(`${err instanceof Error ? err.message : "Could not save this to your history"} — it will not be auto-saved`);
      }
    }
    const r = addManualPart(
      groupsRef.current,
      mfShape,
      { name: mf.name, th: Number(mf.th) || 0, material: mf.material, qty: Number(mf.qty) || 1 },
      counters.current,
    );
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    setG(r.groups);
    const row = r.groups.find((x) => x.id === r.id)!;
    const add = Math.max(1, Math.round(Number(mf.qty) || 1));
    setMsg(
      r.merged
        ? `${row.name}: same part already in the list (#${row.sn}) — quantity is now ${row.qty}.`
        : `${row.name} added as part #${row.sn} (${row.w.toFixed(1)} × ${row.h.toFixed(1)} mm, quantity ${add}).`,
    );
    toast.success(r.merged ? `Quantity of #${row.sn} increased to ${row.qty}` : `Part #${row.sn} added — ${row.name}`);
    flashRows([r.id]);
    if (keepOpen) setMf((f) => ({ ...f, name: "" }));
    else {
      setManualOpen(false);
      setMf(EMPTY_MANUAL);
    }
  }

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
  function readSettings(c: typeof cfg = cfg): Settings | null {
    const v = {
      W: Number(c.W), H: Number(c.H), mg: Number(c.mg), gp: Number(c.gp),
      cell: Number(c.cell), ro: Number(c.ro),
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

  async function start(only?: { groups: Group[]; c: typeof cfg; base?: OptResult | null; fillExisting?: boolean }) {
    multiRef.current = null;
    const c = only?.c ?? cfg;
    const S = readSettings(c);
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
    const res = await runOptimize(only?.groups ?? groupsRef.current, {
      S,
      pair: c.pair,
      common: c.common,
      timeSec: Number(c.tm) || 20,
      base: only?.base ?? null,
      fillExisting: only?.fillExisting,
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
    if (!res) setStatus(only?.base ? "All pieces are already placed — nothing left to nest." : "Nothing to nest — all quantities are 0.");
    else {
      setResS(S);
      setResult(res);
    }
    setRunning(false);
  }

  /** Is there a nest on screen whose sheet size / edge margin the next parts must keep? */
  const soloLock = !!(result && resS && result.sheets.some((x) => x.items.length));

  /** Is the popup's sheet info the same as the current nest's? Then the part is nested into that nest's free space. */
  function soloContinues(c: typeof cfg): boolean {
    const S = readSettings(c);
    return !!(S && result && resS && result.sheets.length > 0 && canContinueOn(S, resS));
  }

  /** Main "Optimize nest" button: rebuild everything, or continue the current nest with the pieces not placed yet. */
  function runMain() {
    const base = resultRef.current;
    if (hasNest && nestMode !== "scratch" && base && resS) {
      // sheet length / width / edge margin stay those of the nest; spacing, rotation, time ... come from the page
      const c = { ...cfg, W: String(resS.W), H: String(resS.H), mg: String(resS.mg) };
      void start({ groups: groupsRef.current, c, base, fillExisting: nestMode === "fill" });
      return;
    }
    if (result?.manual && result.sheets.some((x) => x.items.length)) setConfirmOptimize(true);
    else void start();
  }

  /** "Nest this part alone": continues the current nest when the sheet info matches, otherwise starts a new nest. */
  function runSolo(s: { g: Group; c: typeof cfg }, replaceOk = false) {
    const g = groupsRef.current.find((x) => x.id === s.g.id) ?? s.g;
    if (leftOf(g, placedCounts(resultRef.current)) <= 0) {
      toast.info(`All pieces of part #${g.sn} are already placed.`);
      return;
    }
    if (soloContinues(s.c)) {
      void start({ groups: [g], c: s.c, base: resultRef.current, fillExisting: soloFill });
      return;
    }
    if (!replaceOk && result?.sheets.some((x) => x.items.length)) {
      setConfirmSolo(true);
      return;
    }
    void start({ groups: [g], c: s.c, base: null });
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

  // ---- Auto-save of the whole 2D workspace (parts, settings, result, saved nests) to the selected project.
  const autosave = useNestingAutosave({
    kind: "2D",
    workspaceId,
    consumeFresh,
    capture: () =>
      encodeSnapshot({
        cfg, units, groups: groupsRef.current, counters: counters.current, savedSeq: savedSeq.current,
        importedIds: importedIds.current, result: resultRef.current, resS, savedNests, activeNestId,
      }),
    restore: (data) => {
      runRef.current++;
      stopRef.current = true;
      selRef.current = null;
      setRunning(false);
      setStatus("");
      const d = data ? decodeSnapshot(data) : null;
      if (!d) {
        setG([]);
        counters.current = { id: 0, sn: 0 };
        savedSeq.current = 0;
        importedIds.current = new Set();
        setSavedNests([]);
        setActiveNestId(null);
        setResult(null);
        setResS(null);
        setMsg(DEFAULT_MSG);
        bump();
        return;
      }
      setCfg({ ...d.cfg });
      setUnits(d.units);
      setG(d.groups);
      counters.current = d.counters;
      savedSeq.current = d.savedSeq;
      importedIds.current = new Set(d.importedIds);
      setSavedNests(d.savedNests);
      setActiveNestId(d.activeNestId);
      setResS(d.resS);
      setResult(d.result);
      setActiveSheet(0);
      setMsg(`Restored the saved nest of this project (${d.groups.length} part type(s)${d.result ? `, ${d.result.sheets.length} sheet(s)` : ""}).`);
      bump();
    },
    busy: () => !!selRef.current || !!multiRef.current || running,
    deps: [groups, result, resS, cfg, units, savedNests, activeNestId, version],
  });

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
      projectName: workspaceLabel || undefined,
      result,
      S,
      groups: groupsRef.current,
      renderSheet: (i) => {
        const sh = result.sheets[i];
        const W = sh.W ?? S.W;
        const H = sh.H ?? S.H;
        const k = Math.min(3, 3200 / W); // 2x supersampled export so printed / Excel pictures stay sharp
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(W * k));
        cv.height = Math.max(1, Math.round(H * k));
        drawSheet(sh, cv, k, S, null, false, { dpr: 2 });
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
  }, [result, resS, workspaceLabel]);

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
  const hasNest = !!(result && resS && result.sheets.some((x) => x.items.length));
  const lockSheet = hasNest && nestMode !== "scratch";
  const settingsGrid = (
    <div className="grid grid-cols-2 gap-2">
      {hasNest && (
        <div className="col-span-2 space-y-1">
          <Field label="When a nest already exists">
            <select className={selectCls} value={nestMode} onChange={(e) => setNestMode(e.target.value as "scratch" | "fill" | "new")}>
              <option value="scratch">Start from scratch (all parts, replaces the current nest)</option>
              <option value="fill">Continue: only parts not placed yet — free space of current sheets first, then new sheets</option>
              <option value="new">Continue: only parts not placed yet — on new sheets only</option>
            </select>
          </Field>
          {lockSheet && (
            <p className="text-xs text-muted-foreground">
              Sheet length, width and edge margin are locked to the current nest. Part spacing can be different for the new parts.
            </p>
          )}
        </div>
      )}
      <Field label="Sheet length (mm)">
        <Input type="number" disabled={lockSheet} value={lockSheet && resS ? String(resS.W) : cfg.W} onChange={(e) => setCfg({ ...cfg, W: e.target.value })} />
      </Field>
      <Field label="Sheet width (mm)">
        <Input type="number" disabled={lockSheet} value={lockSheet && resS ? String(resS.H) : cfg.H} onChange={(e) => setCfg({ ...cfg, H: e.target.value })} />
      </Field>
      <Field label="Edge margin (mm)">
        <Input type="number" disabled={lockSheet} value={lockSheet && resS ? String(resS.mg) : cfg.mg} onChange={(e) => setCfg({ ...cfg, mg: e.target.value })} />
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
          </div>
  );

  // ---- Parts list: filter options (built from what is in the list) and the rows that pass the filters
  const fileOpts = [...new Set(groups.map((g) => g.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const thOpts = [...new Set(groups.map((g) => g.th))].sort((a, b) => a - b);
  const matOpts = [...new Set(groups.map((g) => g.material || ""))].sort((a, b) => a.localeCompare(b));
  // a filter whose value is no longer in the list (part removed ...) simply stops filtering
  const eFile = fileOpts.includes(fFile) ? fFile : "";
  const eTh = thOpts.some((t) => String(t) === fTh) ? fTh : "";
  const eMat = fMat === "__none__" ? (matOpts.includes("") ? fMat : "") : matOpts.includes(fMat) ? fMat : "";
  const visible = groups.filter(
    (g) =>
      (!eFile || g.name === eFile) &&
      (!eTh || String(g.th) === eTh) &&
      (!eMat || (eMat === "__none__" ? !g.material : g.material === eMat)) &&
      (!fLeft || (fLeft === "left" ? leftOf(g, placed) > 0 : leftOf(g, placed) <= 0)),
  );
  const filtersOn = !!(eFile || eTh || eMat || fLeft);
  const clearFilters = () => {
    setFFile("");
    setFTh("");
    setFMat("");
    setFLeft("");
  };
  // only the selected parts that are on screen are acted on, so a hidden row is never removed by accident
  const checkedVis = visible.filter((g) => checked.has(g.id)).map((g) => g.id);

  const thInput = (g: Group) => (
    <Input
      type="number" min={0} step="any" placeholder="mm" className="h-8 w-full min-w-16 md:w-20"
      value={g.th || ""}
      onChange={(e) => updateGroup(g.id, { th: Number(e.target.value) || 0 })}
    />
  );
  const matInput = (g: Group) => (
    <Input
      type="text" placeholder="e.g. S235" className="h-8 w-full min-w-20 md:w-24"
      value={g.material || ""}
      onChange={(e) => updateGroup(g.id, { material: e.target.value })}
    />
  );
  const qtyInput = (g: Group) => (
    <Input
      type="number" min={0} className="h-8 w-full min-w-16 md:w-20" value={g.qty}
      onChange={(e) => updateGroup(g.id, { qty: Math.max(0, Number(e.target.value) | 0) })}
    />
  );
  const leftBtn = (g: Group) => {
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
        className={`flex select-none items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${
          left > 0
            ? "cursor-grab border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 active:cursor-grabbing"
            : "cursor-not-allowed border-border text-muted-foreground opacity-60"
        }`}
        style={{ touchAction: "none" }}
      >
        <Plus className="h-3 w-3" /> {left} left
      </button>
    );
  };
  const nestBtn = (g: Group) => (
    <Button
      variant="outline" size="sm" className="h-7 whitespace-nowrap"
      disabled={running || !!held || leftOf(g, placed) <= 0}
      title={
        leftOf(g, placed) > 0
          ? "Nest this part with its own settings — it continues in the free space of the current nest"
          : "All pieces of this part are already placed"
      }
      onClick={() => {
        // start from the current nest's sheet info, so the part simply continues on those sheets
        const c0 =
          result && resS && result.sheets.length
            ? { ...cfg, W: String(resS.W), H: String(resS.H), mg: String(resS.mg), gp: String(resS.gp), cell: String(resS.cell) }
            : { ...cfg };
        setSolo({ g, c: c0 });
        setSoloOpen(true);
      }}
    >
      <Layers /> Nest
    </Button>
  );
  const rowChecked = (g: Group) => (
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
  );
  const rowTint = (g: Group) => (newIds.has(g.id) ? "bg-emerald-100 dark:bg-emerald-950/40" : checked.has(g.id) ? "bg-primary/5" : "");

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(300px,380px)_1fr]">
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1. Import</h3>
          <div className="mb-2">
            {workspaceId ? (
              <AutosaveBadge state={autosave.state} savedAt={autosave.savedAt} projectLabel={workspaceLabel} />
            ) : (
              <p className="text-xs text-muted-foreground">No project selected — importing a DXF saves it to your history (name + date) and auto-saves into it. Use “Save as project” above when you are done.</p>
            )}
          </div>
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
          <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" title="Load a nest DXF exported from here: the parts go into the list and the sheets are rebuilt as drawn">
            <FolderInput className="h-4 w-4" /> Import nest DXF (sheets + parts)
            <input
              type="file"
              accept=".dxf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleNestFile(f);
              }}
            />
          </label>
          <Button variant="outline" className="mt-2 w-full" onClick={() => setManualOpen(true)} title="Type a part in: rectangle (length × width), triangle (two sides and the angle between them) or circle (diameter), with an optional round hole">
            <Shapes /> Add part by dimensions
          </Button>
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
              onClick={() => runMain()}
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
        <Card className="p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parts &amp; quantities
              {groups.length > 0 && (
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {filtersOn ? `${visible.length} of ${groups.length} shown` : `${groups.length} part(s)`}
                </span>
              )}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="On: changing the length also changes the width (and the other way round) so the shape and its holes keep their proportions. Off: only the one you type changes.">
                <Checkbox checked={keepRatio} onCheckedChange={(v) => setKeepRatio(v === true)} />
                Keep proportions
              </label>
              {checkedVis.length > 0 && (
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setPendingRemove(checkedVis)}>
                  <Trash2 /> Remove selected ({checkedVis.length})
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

          {groups.length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/30 p-2 md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end">
              <Field label="File">
                <select className={selectCls} value={eFile} onChange={(e) => setFFile(e.target.value)}>
                  <option value="">All files ({groups.length})</option>
                  {fileOpts.map((n) => (
                    <option key={n} value={n}>{n} ({groups.filter((g) => g.name === n).length})</option>
                  ))}
                </select>
              </Field>
              <Field label="Thickness">
                <select className={selectCls} value={eTh} onChange={(e) => setFTh(e.target.value)}>
                  <option value="">All thicknesses</option>
                  {thOpts.map((t) => (
                    <option key={t} value={String(t)}>
                      {t ? `${t} mm` : "Unknown (?)"} ({groups.filter((g) => g.th === t).length})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Material">
                <select className={selectCls} value={eMat} onChange={(e) => setFMat(e.target.value)}>
                  <option value="">All materials</option>
                  {matOpts.map((m) => (
                    <option key={m || "__none__"} value={m || "__none__"}>
                      {m || "— none —"} ({groups.filter((g) => (g.material || "") === m).length})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Remaining">
                <select className={selectCls} value={fLeft} onChange={(e) => setFLeft(e.target.value as "" | "left" | "done")}>
                  <option value="">All</option>
                  <option value="left">Has pieces left ({groups.filter((g) => leftOf(g, placed) > 0).length})</option>
                  <option value="done">Fully placed ({groups.filter((g) => leftOf(g, placed) <= 0).length})</option>
                </select>
              </Field>
              <Button variant="ghost" size="sm" className="col-span-2 h-9 md:col-span-4 xl:col-span-1" disabled={!filtersOn} onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}

          {!groups.length ? (
            <p className="text-sm text-muted-foreground">No parts yet.</p>
          ) : !visible.length ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No part matches these filters.
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
              </div>
            </div>
          ) : (
            <>
              {/* ---- tablet / desktop: table (secondary columns appear as the screen gets wider) ---- */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="p-1">
                        <Checkbox
                          aria-label="Select all shown parts"
                          checked={
                            visible.every((g) => checked.has(g.id))
                              ? true
                              : visible.some((g) => checked.has(g.id)) ? "indeterminate" : false
                          }
                          onCheckedChange={(v) =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              for (const g of visible) {
                                if (v === true) next.add(g.id); else next.delete(g.id);
                              }
                              return next;
                            })
                          }
                        />
                      </th>
                      <th className="p-1">#</th>
                      <th className="p-1" />
                      <th className="p-1">File</th>
                      <th className="p-1" title="Type a new length / width: the part is scaled to it (Enter to apply)">Size (mm)</th>
                      <th className="hidden p-1 xl:table-cell">Area</th>
                      <th className="hidden p-1 xl:table-cell">Holes</th>
                      <th className="p-1">Thick (mm)</th>
                      <th className="p-1">Material</th>
                      <th className="p-1">Qty</th>
                      <th className="p-1">Placed</th>
                      <th className="p-1" title="Press a part's picture to take one piece and place it by hand">Left / place by hand</th>
                      <th className="p-1" title="Nest only this part, with its own spacing / margin / rotation">Nest alone</th>
                      <th className="p-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((g) => (
                      <tr key={g.id} data-part-row={g.id} className={`border-t border-border transition-colors duration-700 ${rowTint(g)}`}>
                        <td className="p-1">{rowChecked(g)}</td>
                        <td className="p-1 font-semibold">#{g.sn}</td>
                        <td className="p-1"><PartThumb g={g} /></td>
                        <td className="max-w-40 break-all p-1">{g.name}</td>
                        <td className="p-1 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <DimInput label={`Length of #${g.sn}`} value={g.w} onCommit={(v) => sizeGroup(g, "w", v)} />
                            <span className="text-muted-foreground">×</span>
                            <DimInput label={`Width of #${g.sn}`} value={g.h} onCommit={(v) => sizeGroup(g, "h", v)} />
                          </div>
                        </td>
                        <td className="hidden p-1 xl:table-cell">{Math.round(g.area)}</td>
                        <td className="hidden p-1 xl:table-cell">{g.holes.length}</td>
                        <td className="p-1">{thInput(g)}</td>
                        <td className="p-1">{matInput(g)}</td>
                        <td className="p-1">{qtyInput(g)}</td>
                        <td className="p-1 whitespace-nowrap tabular-nums">{placed.get(g.id) ?? 0}</td>
                        <td className="p-1">{leftBtn(g)}</td>
                        <td className="p-1">{nestBtn(g)}</td>
                        <td className="p-1 whitespace-nowrap">
                          <Button variant="ghost" size="sm" title="Duplicate this part (e.g. to give the copy another thickness)" onClick={() => duplicatePart(g.id)}>
                            <Copy /> <span className="hidden 2xl:inline">Duplicate</span>
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" title="Remove this part" onClick={() => setPendingRemove([g.id])}>
                            <Trash2 /> <span className="hidden 2xl:inline">Remove</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ---- phone: one card per part ---- */}
              <div className="space-y-2 md:hidden">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    aria-label="Select all shown parts"
                    checked={
                      visible.every((g) => checked.has(g.id))
                        ? true
                        : visible.some((g) => checked.has(g.id)) ? "indeterminate" : false
                    }
                    onCheckedChange={(v) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        for (const g of visible) {
                          if (v === true) next.add(g.id); else next.delete(g.id);
                        }
                        return next;
                      })
                    }
                  />
                  Select all shown
                </label>
                {visible.map((g) => (
                  <div key={g.id} data-part-row={g.id} className={`rounded-lg border border-border p-3 transition-colors duration-700 ${rowTint(g)}`}>
                    <div className="flex items-center gap-2">
                      {rowChecked(g)}
                      <span className="text-sm font-semibold">#{g.sn}</span>
                      <PartThumb g={g} />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="break-all font-medium">{g.name}</div>
                        <div className="text-muted-foreground">
                          area {Math.round(g.area)} · {g.holes.length} hole(s)
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Length (mm)"><DimInput label={`Length of #${g.sn}`} value={g.w} onCommit={(v) => sizeGroup(g, "w", v)} /></Field>
                      <Field label="Width (mm)"><DimInput label={`Width of #${g.sn}`} value={g.h} onCommit={(v) => sizeGroup(g, "h", v)} /></Field>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Field label="Thick (mm)">{thInput(g)}</Field>
                      <Field label="Material">{matInput(g)}</Field>
                      <Field label="Qty">{qtyInput(g)}</Field>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Placed {placed.get(g.id) ?? 0}</span>
                      {leftBtn(g)}
                      {nestBtn(g)}
                      <div className="ml-auto flex">
                        <Button variant="ghost" size="sm" title="Duplicate this part" onClick={() => duplicatePart(g.id)}>
                          <Copy />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" title="Remove this part" onClick={() => setPendingRemove([g.id])}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
                        <CutSizeInput
                          value={Math.round(sh.W ?? resS.W)}
                          max={Math.round(resS.W)}
                          onCommit={(v) => {
                            resizeSheet(sh, resS, v, sh.H ?? resS.H);
                            bump();
                          }}
                        />
                        ×
                        <CutSizeInput
                          value={Math.round(sh.H ?? resS.H)}
                          max={Math.round(resS.H)}
                          onCommit={(v) => {
                            resizeSheet(sh, resS, sh.W ?? resS.W, v);
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
                            onClick={() => runMain()}
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
                      <SheetCanvas sheet={sh} index={i} S={resS} width={fs === i ? fsWidth : width} selRef={selRef} version={version} heldIdx={held ? held.idx : null} dragRef={dragRef} multiRef={multiRef} selectMode={selectMode} fullscreen={fs === i} onChange={bump} />
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
                runMain();
              }}
            >
              <Layers /> Optimize nest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Add part by dimensions</DialogTitle>
            <DialogDescription>Type the size of the part (mm) and it is added to the list, ready to nest.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["rect", "Rectangle", Square],
                ["triangle", "Triangle", TriangleIcon],
                ["trapezoid", "Trapezoid", TrapezoidIcon],
                ["circle", "Circle", CircleIcon],
              ] as const
            ).map(([k, label, Icon]) => (
              <Button key={k} type="button" variant={mf.kind === k ? "default" : "outline"} onClick={() => setMf({ ...mf, kind: k })}>
                <Icon /> {label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11.5rem]">
            <div className="space-y-3">
              {mf.kind === "rect" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Length (mm)"><Input type="number" min={0} step="any" inputMode="decimal" autoFocus value={mf.w} onChange={(e) => setMf({ ...mf, w: e.target.value })} /></Field>
                  <Field label="Width (mm)"><Input type="number" min={0} step="any" inputMode="decimal" value={mf.h} onChange={(e) => setMf({ ...mf, h: e.target.value })} /></Field>
                </div>
              )}
              {mf.kind === "triangle" && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Side 1 (mm)"><Input type="number" min={0} step="any" inputMode="decimal" autoFocus value={mf.a} onChange={(e) => setMf({ ...mf, a: e.target.value })} /></Field>
                  <Field label="Side 2 (mm)"><Input type="number" min={0} step="any" inputMode="decimal" value={mf.b} onChange={(e) => setMf({ ...mf, b: e.target.value })} /></Field>
                  <Field label="Angle between (°)"><Input type="number" min={0} max={180} step="any" inputMode="decimal" value={mf.angle} onChange={(e) => setMf({ ...mf, angle: e.target.value })} /></Field>
                </div>
              )}
              {mf.kind === "trapezoid" && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Bottom base (mm)"><Input type="number" min={0} step="any" inputMode="decimal" autoFocus value={mf.tzA} onChange={(e) => setMf({ ...mf, tzA: e.target.value })} /></Field>
                    <Field label="Top base (mm)"><Input type="number" min={0} step="any" inputMode="decimal" value={mf.tzB} onChange={(e) => setMf({ ...mf, tzB: e.target.value })} /></Field>
                    <Field label="Height (mm)"><Input type="number" min={0} step="any" inputMode="decimal" value={mf.tzH} onChange={(e) => setMf({ ...mf, tzH: e.target.value })} /></Field>
                  </div>
                  <Field label="Sides">
                    <select className={selectCls} value={mf.tzRight ? "right" : "sym"} onChange={(e) => setMf({ ...mf, tzRight: e.target.value === "right" })}>
                      <option value="sym">Symmetric (both sides lean the same)</option>
                      <option value="right">Right-angled (left side at 90°)</option>
                    </select>
                  </Field>
                </>
              )}
              {mf.kind === "circle" && (
                <Field label="Diameter (mm)"><Input type="number" min={0} step="any" inputMode="decimal" autoFocus value={mf.d} onChange={(e) => setMf({ ...mf, d: e.target.value })} /></Field>
              )}

              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={mf.hasHole} onCheckedChange={(v) => setMf({ ...mf, hasHole: v === true })} />
                  Has a round hole{mf.kind === "triangle" || mf.kind === "trapezoid" ? " (in the middle of the shape)" : " (in the middle)"}
                </label>
                {mf.hasHole && (
                  <Field label="Hole diameter (mm)">
                    <Input type="number" min={0} step="any" inputMode="decimal" value={mf.hole} onChange={(e) => setMf({ ...mf, hole: e.target.value })} />
                  </Field>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Field label="Thickness (mm)"><Input type="number" min={0} step="any" inputMode="decimal" value={mf.th} onChange={(e) => setMf({ ...mf, th: e.target.value })} /></Field>
                <Field label="Material"><Input type="text" placeholder="e.g. S235" value={mf.material} onChange={(e) => setMf({ ...mf, material: e.target.value })} /></Field>
                <Field label="Quantity"><Input type="number" min={1} step={1} value={mf.qty} onChange={(e) => setMf({ ...mf, qty: e.target.value })} /></Field>
              </div>
              <Field label="Name (optional)">
                <Input type="text" placeholder={"error" in mfGeo ? "e.g. Base plate" : manualPartName(mfShape)} value={mf.name} onChange={(e) => setMf({ ...mf, name: e.target.value })} />
              </Field>
            </div>

            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-secondary/30 p-2">
              {"error" in mfGeo ? (
                <p className={`text-center text-xs ${mfTouched ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                  {mfTouched ? mfGeo.error : "The part is drawn here as you type."}
                </p>
              ) : (
                <>
                  <StripThumb g={{ ...mfGeo, id: 3, sn: 0, name: "", qty: 1, th: 0, material: "" }} w={168} h={112} />
                  <p className="text-center text-xs text-muted-foreground">
                    {mfGeo.w.toFixed(1)} × {mfGeo.h.toFixed(1)} mm
                    <br />
                    area {Math.round(mfGeo.area)} mm²
                  </p>
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button variant="outline" disabled={"error" in mfGeo} onClick={() => void addManual(true)} title="Add this part and keep the window open for the next one">
              Add &amp; add another
            </Button>
            <Button disabled={"error" in mfGeo} onClick={() => void addManual(false)}>
              <Plus /> Add part
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingResize}
        onOpenChange={(v) => !v && setPendingResize(null)}
        title="Resize this part?"
        description="This part is already placed on the sheets. The nesting result will be cleared and you'll need to press Optimize again."
        confirmLabel="Resize"
        onConfirm={() => {
          if (pendingResize) doResize(pendingResize.id, pendingResize.w, pendingResize.h);
          setPendingResize(null);
        }}
      />

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

      <Dialog open={!!pendingImport} onOpenChange={(o) => !o && setPendingImport(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl p-4 sm:p-6">
          {pendingImport && (() => {
            const pi = pendingImport;
            const newRows = pi.rows.filter((x) => x.status === "new").length;
            const mergedRows = pi.rows.length - newRows;
            const pieces = pi.rows.reduce((n, x) => n + x.add, 0);
            const bad = pi.files.filter((x) => x.r.unclosed.length);
            const badCount = bad.reduce((n, x) => n + x.r.unclosed.length, 0);
            const empty = pi.files.filter((x) => !x.r.loops.length && !x.r.unclosed.length);
            const noTh = pi.rows.filter((x) => !x.g.th).length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Review before adding</DialogTitle>
                  <DialogDescription>
                    {pi.files.length} file(s) · {newRows} new part(s)
                    {mergedRows > 0 && <> · {mergedRows} added to an existing row</>} · {pieces} piece(s) in total. Nothing is added until you press “Add”.
                  </DialogDescription>
                </DialogHeader>

                {(badCount > 0 || empty.length > 0 || noTh > 0) && (
                  <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                    {bad.map((x) => (
                      <p key={x.f.name} className="flex items-start gap-1.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span><b>{x.f.name}</b>: {x.r.unclosed.length} contour(s) will NOT be imported — the outline has a gap (close it in AutoCAD with JOIN / PEDIT and import again).</span>
                      </p>
                    ))}
                    {empty.map((x) => (
                      <p key={x.f.name} className="flex items-start gap-1.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span><b>{x.f.name}</b>: no usable contour found in this file.</span>
                      </p>
                    ))}
                    {noTh > 0 && (
                      <p className="flex items-start gap-1.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{noTh} part(s) have no thickness yet (shown as “?”) — you can type it in the list after adding.</span>
                      </p>
                    )}
                  </div>
                )}

                {pi.rows.length > 0 ? (
                  <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-xs">
                      <thead className="sticky top-0 bg-card text-left text-muted-foreground shadow-[0_1px_0_0_var(--border,#e5e7eb)]">
                        <tr>
                          <th className="p-2">#</th>
                          <th className="p-2" />
                          <th className="p-2">File</th>
                          <th className="p-2">Size (mm)</th>
                          <th className="hidden p-2 sm:table-cell">Area</th>
                          <th className="hidden p-2 sm:table-cell">Holes</th>
                          <th className="p-2">Thick (mm)</th>
                          <th className="p-2">Qty</th>
                          <th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pi.rows.map((x, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="p-2 text-muted-foreground">{i + 1}</td>
                            <td className="p-1"><PartThumb g={x.g} /></td>
                            <td className="max-w-32 break-all p-2 sm:max-w-none">{x.file}</td>
                            <td className="p-2 whitespace-nowrap">{x.g.w.toFixed(1)} × {x.g.h.toFixed(1)}</td>
                            <td className="hidden p-2 sm:table-cell">{Math.round(x.g.area)}</td>
                            <td className="hidden p-2 sm:table-cell">{x.g.holes.length}</td>
                            <td className={`p-2 ${x.g.th ? "" : "font-semibold text-amber-600"}`}>{x.g.th || "?"}</td>
                            <td className="p-2 font-semibold tabular-nums">+{x.add}</td>
                            <td className="p-2 whitespace-nowrap">
                              {x.status === "new" ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">New part</span>
                              ) : (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800" title="Same shape, thickness and material already in the list: its quantity goes up">
                                  Adds to #{x.g.sn}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing to add from these files.</p>
                )}

                <DialogFooter>
                  <Button variant="secondary" onClick={() => setPendingImport(null)}>Cancel</Button>
                  <Button disabled={!pi.rows.length} onClick={() => void confirmImport()}>
                    <Plus /> Add {pieces > 0 ? `${pi.rows.length} part(s)` : ""}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={soloOpen} onOpenChange={setSoloOpen}>
        <DialogContent className="max-w-md">
          {solo && (
            <>
              <DialogHeader>
                <DialogTitle>Nest part #{solo.g.sn} alone</DialogTitle>
                <DialogDescription>
                  {solo.g.name} — {leftOf(solo.g, placed)} pcs left to nest. Only this part is nested, using the settings below (the page settings stay as they are).
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Sheet length (mm)">
                  <Input type="number" disabled={soloLock} value={solo.c.W} onChange={(e) => setSolo({ ...solo, c: { ...solo.c, W: e.target.value } })} />
                </Field>
                <Field label="Sheet width (mm)">
                  <Input type="number" disabled={soloLock} value={solo.c.H} onChange={(e) => setSolo({ ...solo, c: { ...solo.c, H: e.target.value } })} />
                </Field>
                <Field label="Edge margin (mm)">
                  <Input type="number" disabled={soloLock} value={solo.c.mg} onChange={(e) => setSolo({ ...solo, c: { ...solo.c, mg: e.target.value } })} />
                </Field>
                <Field label="Gap between parts (mm) — 0 = none, for this part">
                  <Input type="number" min={0} value={solo.c.gp} onChange={(e) => setSolo({ ...solo, c: { ...solo.c, gp: e.target.value } })} />
                </Field>
                <Field label="Rotation">
                  <select className={selectCls} value={solo.c.ro} onChange={(e) => setSolo({ ...solo, c: { ...solo.c, ro: e.target.value } })}>
                    <option value="0">None</option>
                    <option value="1">0° / 180°</option>
                    <option value="2">90° steps</option>
                    <option value="3">45° steps</option>
                    <option value="4">15° steps (slower)</option>
                  </select>
                </Field>
                <Field label="Optimize time (s)">
                  <Input type="number" value={solo.c.tm} onChange={(e) => setSolo({ ...solo, c: { ...solo.c, tm: e.target.value } })} />
                </Field>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={solo.c.pair} onCheckedChange={(v) => setSolo({ ...solo, c: { ...solo.c, pair: v === true } })} />
                  Auto-pair triangles
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={solo.c.common} onCheckedChange={(v) => setSolo({ ...solo, c: { ...solo.c, common: v === true } })} />
                  Common cut line
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {soloLock
                  ? soloFill
                    ? "Sheet size and edge margin are locked to the current nest. This part (with the gap above) goes into the free space of the sheets already nested (same material and thickness), then opens new sheets if needed."
                    : "Sheet size and edge margin are locked to the current nest. The existing sheets are left untouched; this part goes on new sheets only."
                  : "A new nest will be built for this part."}
              </p>
              {soloLock && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={soloFill} onCheckedChange={(v) => setSoloFill(v === true)} />
                  Fill the free space of the existing sheets first
                </label>
              )}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setSoloOpen(false)}>Cancel</Button>
                <Button
                  disabled={running || !!held}
                  onClick={() => {
                    setSoloOpen(false);
                    runSolo(solo);
                  }}
                >
                  <Layers /> {soloContinues(solo.c) ? "Add to current nest" : "Nest this part"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSolo}
        onOpenChange={setConfirmSolo}
        title="Start a new nest?"
        description="The sheet size or edge margin you chose differ from the current nest, so this part can't share its sheets. The current nest will be replaced — save it first if you want to keep it."
        confirmLabel="Nest this part"
        onConfirm={() => {
          setConfirmSolo(false);
          if (solo) runSolo(solo, true);
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