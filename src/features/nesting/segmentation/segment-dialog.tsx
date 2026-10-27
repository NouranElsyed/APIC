"use client";
/**
 * Segmentation dialog (settings, editable preview, approval).
 *
 * The part is only read and layouts are generated and edited on a draft; closing the dialog discards
 * everything. Only "Approve" hands the finished plan to the caller (`onApprove`), which creates the
 * pieces. A part that is already segmented opens with its saved cuts for editing.
 */
import * as React from "react";
import { ArrowLeftRight, Download, Layers, Loader2, Pencil, Plus, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { makeSettings, type Group, type runOptimize } from "../nest-boost/engine";
import { evaluatePlan, type EngineCtx, type EngineEval } from "./evaluate";
import { PRIORITY_LABEL, compareRows, explainOrder, rankCandidates, sheetsText, type Priority } from "./rank";
import { classifyFit } from "./fit";
import {
  addFreeCut,
  addSeam,
  addStripCut,
  boundsFor,
  canRedo,
  canUndo,
  commit,
  cutPos,
  endGesture,
  handleLines,
  isEdited,
  isFreeCut,
  moveCut,
  moveFreeCut,
  moveFreePoint,
  newEditor,
  redo,
  removeCut,
  removeFreePoint,
  reset,
  splitFreeSegment,
  stateFromInput,
  toPlanInput,
  undo,
  type Bounds,
  type EditResult,
  type Editor,
  type EditorState,
} from "./editor";
import { candidateFacts, defaultForm, formFromInput, parseForm, planBaseFromForm, type NestCtx, type SegForm } from "./form";
import { savedPlan } from "./commit";
import { exportSegmentation, type ExportResult } from "./export-action";
import { regionBBox, regionInteriorPoint } from "./geometry";
import { groupToRegion } from "./group-region";
import { buildPlan, generateCandidates, type Candidate, type Plan, type PlanInput } from "./planner";
import { regionPath, screenToWorld, seamLines, segmentFill, segmentStroke, svgViewBox } from "./preview-path";
import type { Pt, Region } from "./types";

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

const mm = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

/** What the preview needs to make cut lines draggable. */
export interface PreviewEdit {
  state: EditorState;
  bounds: Bounds;
  selected: string | null;
  /** When set, the next press on the drawing adds a cut of that kind ("free": press, drag and release to draw a line). */
  mode: "strip" | "seam" | "free" | null;
  onSelect: (id: string | null) => void;
  /** `value` is the new coordinate of the dragged line along its movable axis (world mm). */
  onDrag: (id: string, value: number) => void;
  onDragEnd: () => void;
  onAdd: (kind: "strip" | "seam", at: { across: number; along: number }) => void;
  /** A finished hand-drawn stroke (world mm, as drawn). */
  onAddFree: (stroke: Pt[]) => void;
  /** Free cuts: drag one vertex / the whole line / double-click a line to add a vertex or a vertex to remove it. */
  onMoveFreePoint: (id: string, index: number, to: Pt) => void;
  onMoveFree: (id: string, dx: number, dy: number) => void;
  onSplitFree: (id: string, index: number) => void;
  onRemoveFreePoint: (id: string, index: number) => void;
}

const STRIP_COLOR = "hsl(215 90% 55%)";
const SEAM_COLOR = "hsl(280 70% 55%)";
const FREE_COLOR = "hsl(0 80% 50%)";

type Drag =
  | { id: string; kind: "strip" | "seam" }
  | { id: string; kind: "free-move"; last: { x: number; y: number } }
  | { id: string; kind: "free-point"; index: number };

/** Exact-geometry drawing of a plan: original outline, numbered segments, seams, overlap zones; cut lines are draggable when `edit` is given. */
export function PlanPreview({ region, plan, edit }: { region: Region; plan: Plan; edit?: PreviewEdit }) {
  const { box, size } = React.useMemo(() => svgViewBox(region), [region]);
  const labels = React.useMemo(() => plan.segments.map((s) => ({ id: s.id, p: regionInteriorPoint(s.finished) })), [plan]);
  const handles = React.useMemo(() => (edit ? handleLines(edit.state, edit.bounds) : []), [edit]);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const dragging = React.useRef<Drag | null>(null);
  // the stroke being drawn with the free-cut tool (ref for the event handlers, state to redraw)
  const strokeRef = React.useRef<Pt[] | null>(null);
  const [stroke, setStroke] = React.useState<Pt[] | null>(null);
  const H = edit?.state.direction === "H";

  const world = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return screenToWorld(rect, box, e.clientX, e.clientY);
  };
  // a strip cut moves across the strips, a seam along them
  const across = (w: { x: number; y: number }) => (H ? w.y : w.x);
  const along = (w: { x: number; y: number }) => (H ? w.x : w.y);

  return (
    <svg
      ref={svgRef}
      viewBox={box}
      className={`h-[340px] w-full rounded-lg border border-border bg-card text-foreground ${edit?.mode ? "cursor-crosshair" : ""}`}
      style={edit ? { touchAction: "none" } : undefined}
      role="img"
      aria-label="Segmentation preview"
      onPointerDown={(e) => {
        if (!edit) return;
        if (edit.mode === "free") {
          const w = world(e);
          strokeRef.current = [[w.x, w.y]];
          setStroke(strokeRef.current);
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } else if (edit.mode) {
          const w = world(e);
          edit.onAdd(edit.mode, { across: across(w), along: along(w) });
        } else edit.onSelect(null);
      }}
      onPointerMove={(e) => {
        if (!edit) return;
        if (strokeRef.current) {
          const w = world(e);
          const last = strokeRef.current[strokeRef.current.length - 1];
          if (Math.hypot(w.x - last[0], w.y - last[1]) >= size / 400) {
            strokeRef.current = [...strokeRef.current, [w.x, w.y]];
            setStroke(strokeRef.current);
          }
          return;
        }
        const d = dragging.current;
        if (!d) return;
        const w = world(e);
        if (d.kind === "free-move") {
          edit.onMoveFree(d.id, w.x - d.last.x, w.y - d.last.y);
          d.last = { x: w.x, y: w.y };
        } else if (d.kind === "free-point") edit.onMoveFreePoint(d.id, d.index, [w.x, w.y]);
        else edit.onDrag(d.id, d.kind === "strip" ? across(w) : along(w));
      }}
      onPointerUp={() => {
        if (strokeRef.current) {
          const done = strokeRef.current;
          strokeRef.current = null;
          setStroke(null);
          edit?.onAddFree(done);
          return;
        }
        if (dragging.current) {
          dragging.current = null;
          edit?.onDragEnd();
        }
      }}
      onPointerCancel={() => {
        if (strokeRef.current) {
          strokeRef.current = null;
          setStroke(null);
        }
        if (dragging.current) {
          dragging.current = null;
          edit?.onDragEnd();
        }
      }}
    >
      <g transform="scale(1,-1)" fillRule="evenodd">
        {plan.segments.map((s, i) => (
          <path key={s.id} d={regionPath(s.finished)} fill={segmentFill(i)} stroke={segmentStroke(i)} strokeWidth={size / 600} />
        ))}
        {plan.segments
          .filter((s) => s.cut !== s.finished)
          .map((s) => (
            <path key={`${s.id}-cut`} d={regionPath(s.cut)} fill="none" stroke="currentColor" strokeWidth={size / 700} strokeDasharray={`${size / 120} ${size / 160}`} opacity={0.8} />
          ))}
        <path d={regionPath(region)} fill="none" stroke="currentColor" strokeWidth={size / 400} opacity={0.75} />
        {plan.seams.flatMap((m) =>
          seamLines(m).map((l, k) => <line key={`${m.id}-${k}`} {...l} stroke="hsl(35 95% 50%)" strokeWidth={size / 260} strokeLinecap="round" />),
        )}
        {handles.map((h) => {
          const sel = edit?.selected === h.id;
          const color = h.kind === "strip" ? STRIP_COLOR : SEAM_COLOR;
          const cursor = edit?.mode ? "crosshair" : (h.kind === "strip") === !H ? "ew-resize" : "ns-resize";
          return (
            <g key={h.id} data-cut={h.id}>
              <line x1={h.x1} y1={h.y1} x2={h.x2} y2={h.y2} stroke={color} strokeWidth={sel ? size / 150 : size / 330} strokeDasharray={`${size / 90} ${size / 140}`} pointerEvents="none" />
              <line
                x1={h.x1}
                y1={h.y1}
                x2={h.x2}
                y2={h.y2}
                stroke="transparent"
                strokeWidth={size / 40}
                style={{ cursor }}
                data-handle={h.id}
                onPointerDown={(e) => {
                  if (!edit || edit.mode) return;
                  e.stopPropagation();
                  edit.onSelect(h.id);
                  dragging.current = { id: h.id, kind: h.kind };
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                }}
              />
            </g>
          );
        })}
        {(edit?.state.freeCuts ?? []).map((f) => {
          const sel = edit?.selected === f.id;
          const pts = f.pts.map((q) => `${q[0]},${q[1]}`).join(" ");
          return (
            <g key={f.id} data-cut={f.id}>
              <polyline points={pts} fill="none" stroke={FREE_COLOR} strokeWidth={sel ? size / 150 : size / 300} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
              {f.pts.slice(1).map((q, i) => (
                <line
                  key={i}
                  x1={f.pts[i][0]}
                  y1={f.pts[i][1]}
                  x2={q[0]}
                  y2={q[1]}
                  stroke="transparent"
                  strokeWidth={size / 40}
                  strokeLinecap="round"
                  style={{ cursor: edit?.mode ? "crosshair" : "move" }}
                  data-handle={f.id}
                  onDoubleClick={(e) => {
                    if (!edit || edit.mode) return;
                    e.stopPropagation();
                    edit.onSplitFree(f.id, i);
                  }}
                  onPointerDown={(e) => {
                    if (!edit || edit.mode) return;
                    e.stopPropagation();
                    edit.onSelect(f.id);
                    const w = world(e);
                    dragging.current = { id: f.id, kind: "free-move", last: { x: w.x, y: w.y } };
                    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                  }}
                />
              ))}
              {sel &&
                edit &&
                f.pts.map((q, i) => (
                  <circle
                    key={i}
                    cx={q[0]}
                    cy={q[1]}
                    r={size / 110}
                    fill="white"
                    stroke={FREE_COLOR}
                    strokeWidth={size / 400}
                    style={{ cursor: "grab" }}
                    data-vertex={`${f.id}:${i}`}
                    onDoubleClick={(e) => {
                      if (edit.mode) return;
                      e.stopPropagation();
                      edit.onRemoveFreePoint(f.id, i);
                    }}
                    onPointerDown={(e) => {
                      if (edit.mode) return;
                      e.stopPropagation();
                      dragging.current = { id: f.id, kind: "free-point", index: i };
                      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                    }}
                  />
                ))}
            </g>
          );
        })}
        {stroke && stroke.length > 1 && (
          <polyline points={stroke.map((q) => `${q[0]},${q[1]}`).join(" ")} fill="none" stroke={FREE_COLOR} strokeWidth={size / 200} strokeDasharray={`${size / 120} ${size / 160}`} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
        )}
      </g>
      {labels.map(({ id, p }) =>
        p ? (
          <text key={id} x={p[0]} y={-p[1]} fontSize={size / 42} textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontWeight={600} pointerEvents="none">
            {id}
          </text>
        ) : null,
      )}
      {handles.map((h) => (
        <text key={`${h.id}-label`} x={h.label[0]} y={-h.label[1]} fontSize={size / 50} fill={h.kind === "strip" ? STRIP_COLOR : SEAM_COLOR} fontWeight={edit?.selected === h.id ? 700 : 500} pointerEvents="none">
          {h.id}
        </text>
      ))}
      {(edit?.state.freeCuts ?? []).map((f) => {
        const q = f.pts[Math.floor((f.pts.length - 1) / 2)];
        return (
          <text key={`${f.id}-label`} x={q[0] + size / 90} y={-q[1] - size / 90} fontSize={size / 50} fill={FREE_COLOR} fontWeight={edit?.selected === f.id ? 700 : 500} pointerEvents="none">
            {f.id}
          </text>
        );
      })}
    </svg>
  );
}

const statusChip = (s: string) =>
  s === "READY"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
    : s === "READY_SOLO"
      ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
      : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200";

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function SegmentationPanel({
  group,
  nest: nestProp,
  onClose,
  onApprove,
  existing,
  runEngine,
  exportFn,
}: {
  group: Group;
  nest: NestCtx;
  /** Replaces the nesting engine used by "Check with nesting engine" (tests). */
  runEngine?: typeof runOptimize;
  /** Replaces the zip download of "Export" (tests). */
  exportFn?: typeof exportSegmentation;
  onClose?: () => void;
  /** Called with the validated plan when the user approves. */
  onApprove?: (plan: Plan) => void;
  /** The saved cuts of an already segmented part: the panel opens on them instead of generating layouts. */
  existing?: PlanInput | null;
}) {
  // the parent passes a fresh object on every render; depend on the numbers only
  const nest = React.useMemo<NestCtx>(
    () => ({ W: nestProp.W, H: nestProp.H, mg: nestProp.mg, ro: nestProp.ro, gp: nestProp.gp, cell: nestProp.cell, pair: nestProp.pair, common: nestProp.common, evalSec: nestProp.evalSec }),
    [nestProp.W, nestProp.H, nestProp.mg, nestProp.ro, nestProp.gp, nestProp.cell, nestProp.pair, nestProp.common, nestProp.evalSec],
  );
  const gr = React.useMemo(() => groupToRegion(group), [group]);
  const fit = React.useMemo(() => classifyFit(group, makeSettings({ W: nest.W, H: nest.H, mg: nest.mg, gp: nest.gp ?? 0, cell: nest.cell ?? 1, ro: nest.ro })), [group, nest]);

  const [form, setForm] = React.useState<SegForm>(() => (existing ? formFromInput(existing) : defaultForm(nest)));
  const [errors, setErrors] = React.useState<string[]>([]);
  const [cands, setCands] = React.useState<Candidate[] | null>(null);
  const [sel, setSel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(!existing); // the first layouts are generated as soon as the dialog opens
  const [confirmed, setConfirmed] = React.useState<string[]>(() => existing?.confirmedHoleCuts ?? []);
  // editing (Phase 5): the draft cut lists with undo/redo, the selected cut, and the active "add" tool
  const [editor, setEditor] = React.useState<Editor | null>(() => (existing ? newEditor(stateFromInput(existing)) : null));
  const [selCut, setSelCut] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"strip" | "seam" | "free" | null>(null);
  const [snapOn, setSnapOn] = React.useState(false);
  const [grid, setGrid] = React.useState("10");
  const [notice, setNotice] = React.useState<string | null>(null);
  // ranking and engine checks (Phase 7)
  const [priority, setPriority] = React.useState<Priority>("sheets");
  const [evals, setEvals] = React.useState<Map<string, EngineEval | null>>(() => new Map());
  const [checking, setChecking] = React.useState<{ done: number; total: number } | null>(null);
  const [compare, setCompare] = React.useState<string[]>([]);
  const [current, setCurrent] = React.useState<{ key: string; result: EngineEval | null | "busy" } | null>(null);
  const [evalSheet, setEvalSheet] = React.useState(0); // which of the source sheets the shown layout targets
  const [exporting, setExporting] = React.useState(false);
  const [exported, setExported] = React.useState<string | null>(null);
  const stopRef = React.useRef(false);
  React.useEffect(
    () => () => {
      stopRef.current = true; // closing the dialog abandons any engine run in progress
    },
    [],
  );
  const set = <K extends keyof SegForm>(k: K, v: SegForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  /** Computes layouts for a form. Only called from timer callbacks, never synchronously from an effect. */
  const run = React.useCallback(
    (f: SegForm) => {
      const parsed = parseForm(f, nest);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        setBusy(false);
        return;
      }
      try {
        const list = generateCandidates(gr.region, parsed.settings);
        setErrors([]);
        setCands(list.slice(0, 12));
        setSel(list[0]?.id ?? null);
        setEvalSheet(list[0]?.sheetIndex ?? 0);
        setEvals(new Map()); // new layouts: earlier engine results no longer apply
        setCompare([]);
        setCurrent(null);
        setConfirmed([]);
        setEditor(list[0] ? newEditor(stateFromInput(list[0].plan.input)) : null);
        setSelCut(null);
        setMode(null);
        setNotice(null);
      } catch (e) {
        setErrors([e instanceof Error ? e.message : "Could not generate layouts."]);
        setCands(null);
      } finally {
        setBusy(false);
      }
    },
    [gr, nest],
  );

  /** Button handler: show the busy state first, then compute (the geometry work blocks the thread briefly). */
  const generate = (f: SegForm) => {
    const discard = editor && isEdited(editor);
    if (discard && typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm("Generating new layouts discards your edits. Continue?")) return;
    setBusy(true);
    setTimeout(() => run(f), 30);
  };

  React.useEffect(() => {
    if (existing) return; // re-opening a saved segmentation: start from its cuts, not from new proposals
    const t = setTimeout(() => run(defaultForm(nest)), 30);
    return () => clearTimeout(t);
  }, [run, nest, existing]);

  const state = editor?.present ?? null;
  const dir = state?.direction;
  const bounds = React.useMemo<Bounds | null>(() => (dir ? boundsFor(regionBBox(gr.region), dir) : null), [gr, dir]);
  // everything except the cuts comes live from the form, so changing overlap / sheets / constraints re-validates at once
  const base = React.useMemo(() => planBaseFromForm(form, nest, confirmed), [form, nest, confirmed]);
  const plan = React.useMemo(() => (state ? buildPlan(gr.region, toPlanInput(state, base)) : null), [gr, state, base]);
  const gridMm = snapOn && Number(grid) > 0 ? Number(grid) : undefined;

  /** Applies an edit result: shows why it was refused/held, and records the new state in the history. */
  const apply = (r: EditResult, gesture?: string): boolean => {
    if (!r.ok) {
      setNotice(r.reason);
      return false;
    }
    setNotice(r.note ?? null);
    setEditor((ed) => (ed ? commit(ed, r.state, gesture) : ed));
    return true;
  };
  const onDrag = (id: string, value: number) => {
    if (state && bounds) apply(moveCut(state, id, value, bounds, gridMm), `drag:${id}`);
  };
  const onDragEnd = () => setEditor((ed) => (ed ? endGesture(ed) : ed));
  const onAdd = (kind: "strip" | "seam", at: { across: number; along: number }) => {
    setMode(null);
    if (!state || !bounds) return;
    const r = kind === "strip" ? addStripCut(state, at.across, bounds, gridMm) : addSeam(state, at.across, at.along, bounds, gridMm);
    if (!apply(r) || !r.ok) return;
    const had = new Set([...state.stripCuts.map((c) => c.id), ...state.seams.map((x) => x.id)]);
    const mine = kind === "strip" ? r.state.stripCuts.find((c) => !had.has(c.id)) : r.state.seams.find((x) => !had.has(x.id));
    setSelCut(mine?.id ?? null);
  };
  const partSize = React.useMemo(() => {
    const [x0, y0, x1, y1] = regionBBox(gr.region);
    return Math.max(x1 - x0, y1 - y0, 1);
  }, [gr]);
  /** A finished stroke: simplified to a polyline (deviation ≤ 0.4 % of the part), added and selected. The tool stays on for the next line. */
  const onAddFree = (stroke: Pt[]) => {
    if (!state) return;
    const r = addFreeCut(state, stroke, partSize / 250, gridMm);
    if (!apply(r) || !r.ok) return;
    setSelCut(r.state.freeCuts[r.state.freeCuts.length - 1]?.id ?? null);
  };
  const onMoveFreePoint = (id: string, index: number, to: Pt) => {
    if (state) apply(moveFreePoint(state, id, index, to, gridMm), `drag:${id}:${index}`);
  };
  const onMoveFree = (id: string, dx: number, dy: number) => {
    if (state) apply(moveFreeCut(state, id, dx, dy), `drag:${id}`);
  };
  const onSplitFree = (id: string, index: number) => {
    if (state) apply(splitFreeSegment(state, id, index));
  };
  const onRemoveFreePoint = (id: string, index: number) => {
    if (state) apply(removeFreePoint(state, id, index));
  };
  const removeSelected = () => {
    if (state && selCut && apply(removeCut(state, selCut))) setSelCut(null);
  };
  const setPos = (text: string) => {
    if (state && bounds && selCut) apply(moveCut(state, selCut, Number(text.replace(",", ".")), bounds, gridMm));
  };
  /** Switches H ↔ V by building the best layout in the other direction (one undoable step). */
  const switchDirection = () => {
    if (!state) return;
    const parsed = parseForm(form, nest);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const other = state.direction === "H" ? "V" : "H";
    setBusy(true);
    setTimeout(() => {
      try {
        const list = generateCandidates(gr.region, { ...parsed.settings, directions: [other] });
        const best = list.find((c) => c.plan.valid) ?? list[0];
        if (!best) {
          setNotice("No layout could be generated in that direction.");
          return;
        }
        // hand-drawn cuts do not depend on the direction: keep them
        setEditor((ed) => (ed ? commit(ed, { ...stateFromInput(best.plan.input), freeCuts: state.freeCuts, nextF: state.nextF }) : ed));
        setEvalSheet(best.sheetIndex);
        setSelCut(null);
        setNotice(null);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not switch direction.");
      } finally {
        setBusy(false);
      }
    }, 30);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!editor) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && (k === "z" || k === "y")) {
      e.preventDefault();
      setEditor((ed) => (ed ? (k === "y" || e.shiftKey ? redo(ed) : undo(ed)) : ed));
      return;
    }
    if (e.key === "Escape" && mode) {
      e.preventDefault();
      setMode(null);
      return;
    }
    if (!selCut || !state || !bounds) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (isFreeCut(state, selCut)) {
      const step = (gridMm ?? 1) * (e.shiftKey ? 10 : 1);
      const move = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, [number, number]>)[e.key];
      if (!move) return;
      e.preventDefault();
      apply(moveFreeCut(state, selCut, move[0], move[1]));
      return;
    }
    // a strip cut moves across the strips, a seam along them; "horizontal" = the line moves left/right
    const horizontal = state.stripCuts.some((c) => c.id === selCut) === (state.direction === "V");
    const sign = (horizontal ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowDown: -1, ArrowUp: 1 } as Record<string, number>)[e.key];
    const cur = cutPos(state, selCut);
    if (!sign || cur === undefined) return;
    e.preventDefault();
    apply(moveCut(state, selCut, cur + sign * (gridMm ?? 1) * (e.shiftKey ? 10 : 1), bounds));
  };
  const selPos = state && selCut ? cutPos(state, selCut) : undefined;

  /* ---- ranking and checking layouts with the real nesting engine ---- */
  const engineCtx = React.useMemo<EngineCtx>(
    () => ({ mg: nest.mg, gp: nest.gp ?? 0, cell: nest.cell ?? 5, ro: nest.ro, pair: !!nest.pair, common: !!nest.common, timeSec: nest.evalSec ?? 2 }),
    [nest],
  );
  const ranked = React.useMemo(() => (cands ? rankCandidates(cands, evals, priority) : []), [cands, evals, priority]);
  const explanation = React.useMemo(() => (ranked.length ? explainOrder(ranked, priority, engineCtx.timeSec) : null), [ranked, priority, engineCtx]);
  const compared = ranked.filter((r) => compare.includes(r.cand.id));
  const planKey = React.useMemo(() => (state ? JSON.stringify([state.direction, state.stripCuts, state.seams, state.freeCuts, base.overlap, base.sheet, base.constraints]) : ""), [state, base]);

  /** Downloads one zip: a DXF per piece (cut geometry), the assembly drawing and the segmentation report. */
  const doExport = async () => {
    if (!plan || !plan.valid || exporting) return;
    setExporting(true);
    setExported(null);
    try {
      const r: ExportResult = await (exportFn ?? exportSegmentation)({ parent: group, original: gr.region, plan });
      setExported(`${r.zipName}: ${r.pieces} piece files, the assembly drawing and the report.`);
    } catch (e) {
      setExported(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  /** Nests the top layouts with the real engine, one after the other, so the list is ordered by real sheet counts. */
  const checkTop = async () => {
    if (checking) return;
    const targets = ranked.filter((r) => r.status !== "invalid").slice(0, 6);
    if (!targets.length) return;
    stopRef.current = false;
    setChecking({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) break;
      const c = targets[i].cand;
      let out: EngineEval | null = null;
      try {
        out = await evaluatePlan(c.plan, group, c.plan.input.sheet.sheets[c.sheetIndex], engineCtx, { shouldStop: () => stopRef.current, run: runEngine });
      } catch {
        out = null;
      }
      if (stopRef.current) break;
      setEvals((m) => new Map(m).set(c.id, out));
      setChecking({ done: i + 1, total: targets.length });
    }
    setChecking(null);
  };
  /** Nests the layout as currently edited (including the user's changes). */
  const checkCurrent = async () => {
    if (!plan || !plan.valid) return;
    const sheet = plan.input.sheet.sheets[evalSheet] ?? plan.input.sheet.sheets[0];
    if (!sheet) return;
    stopRef.current = false;
    const key = planKey;
    setCurrent({ key, result: "busy" });
    let out: EngineEval | null = null;
    try {
      out = await evaluatePlan(plan, group, sheet, engineCtx, { shouldStop: () => stopRef.current, run: runEngine });
    } catch {
      out = null;
    }
    if (stopRef.current) {
      setCurrent(null);
      return;
    }
    setCurrent({ key, result: out });
  };

  const sources = form.sources;
  return (
    <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
      {/* ---------------- settings ---------------- */}
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-border p-3">
          <div className="font-semibold break-all">{group.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {mm(group.w)} × {mm(group.h)} mm · qty {group.qty}
            {group.th ? ` · ${group.th} mm` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChip(fit.status)}`} title={fit.detail}>
              {fit.label}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {gr.fidelity === "arcs" ? `${gr.arcs} arcs rebuilt exactly` : "polygon outline (no arcs found)"}
            </span>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="font-semibold">Source sheets</div>
          {sources.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label={i === 0 ? "Length (mm)" : `Length ${i + 1}`}>
                <Input inputMode="decimal" value={s.length} onChange={(e) => set("sources", sources.map((x) => (x.id === s.id ? { ...x, length: e.target.value } : x)))} />
              </Field>
              <Field label={i === 0 ? "Width (mm)" : `Width ${i + 1}`}>
                <Input inputMode="decimal" value={s.width} onChange={(e) => set("sources", sources.map((x) => (x.id === s.id ? { ...x, width: e.target.value } : x)))} />
              </Field>
              <Button variant="ghost" size="icon" aria-label="Remove source sheet" disabled={sources.length < 2} onClick={() => set("sources", sources.filter((x) => x.id !== s.id))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => set("sources", [...sources, { id: Math.max(0, ...sources.map((x) => x.id)) + 1, length: "", width: "" }])}>
            <Plus /> Add source sheet
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Quantity is unlimited. Edge margin ({nest.mg} mm) and rotation come from the nest settings; the nest itself still uses its own sheet size.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="font-semibold">Direction &amp; pattern</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["H", "Horizontal"],
                ["V", "Vertical"],
                ["auto", "Auto"],
              ] as const
            ).map(([v, label]) => (
              <Button key={v} size="sm" variant={form.direction === v ? "default" : "outline"} onClick={() => set("direction", v)}>
                {label}
              </Button>
            ))}
          </div>
          <Field label="Strip pattern">
            <select className={selectCls} value={form.pattern} onChange={(e) => set("pattern", e.target.value as SegForm["pattern"])}>
              <option value="optimized">Optimized to the sheet (tries several offsets)</option>
              <option value="equal">Equal strips</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={form.staggered} onCheckedChange={(v) => set("staggered", v === true)} />
            Stagger seams between adjacent strips
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={form.allowSolo} onCheckedChange={(v) => set("allowSolo", v === true)} />
            Also try segments that need a margin-free sheet of their own
          </label>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Segmentation Settings</div>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">Optional</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.overlapOn} onCheckedChange={(v) => set("overlapOn", v === true)} />
            Enable overlap
          </label>
          <p className="text-[11px] text-muted-foreground">
            If enabled, neighbouring segments overlap (positive value) or leave a gap between them (negative value). Off by default; the finished shape and the takeoff are not changed, and kerf is not included.
          </p>
          {form.overlapOn && (
            <>
              <Field label="Overlap value (mm)">
                <Input inputMode="decimal" placeholder="enter the value for your job" value={form.overlapMm} onChange={(e) => set("overlapMm", e.target.value)} />
              </Field>
              <p className="text-[11px] text-muted-foreground">Positive: the pieces are welded on top of each other. Negative: a gap between them, e.g. −3.</p>
              <Field label={Number(form.overlapMm.replace(",", ".")) < 0 ? "Gap cut back on" : "Overlap carried by"}>
                <select className={selectCls} value={form.overlapSide} onChange={(e) => set("overlapSide", e.target.value as SegForm["overlapSide"])}>
                  <option value="alternate">Alternating segments</option>
                  <option value="A">Lower-coordinate segment</option>
                  <option value="symmetric">Both segments (half each)</option>
                </select>
              </Field>
            </>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <Field label="Cuts through holes">
            <select className={selectCls} value={form.holePolicy} onChange={(e) => set("holePolicy", e.target.value as SegForm["holePolicy"])}>
              <option value="reject">Reject</option>
              <option value="warn">Warn and let me confirm</option>
            </select>
          </Field>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Seam constraints (all optional)</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Min seam stagger (mm)">
                <Input inputMode="decimal" value={form.minStagger} onChange={(e) => set("minStagger", e.target.value)} />
              </Field>
              <Field label="Min seam-to-edge (mm)">
                <Input inputMode="decimal" value={form.minBoundary} onChange={(e) => set("minBoundary", e.target.value)} />
              </Field>
              <Field label="Max seam length (mm)">
                <Input inputMode="decimal" value={form.maxSeam} onChange={(e) => set("maxSeam", e.target.value)} />
              </Field>
              <Field label="Min segment size (mm)">
                <Input inputMode="decimal" value={form.minSegment} onChange={(e) => set("minSegment", e.target.value)} />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-muted-foreground">
                <Checkbox checked={form.forbidCross} onCheckedChange={(v) => set("forbidCross", v === true)} />
                No seams crossing at the same position
              </label>
            </div>
          </details>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <Button className="w-full" disabled={busy} onClick={() => generate(form)}>
          {busy ? <Loader2 className="animate-spin" /> : <Layers />} Generate layouts
        </Button>
      </div>

      {/* ---------------- results ---------------- */}
      <div className="min-w-0 space-y-3">
        {busy && !cands && <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">Generating layouts…</div>}
        {cands && cands.length === 0 && (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">No layout could be generated with these settings.</div>
        )}
        {cands && cands.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Order by
                <select className={`${selectCls} h-8 w-auto`} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label="Order layouts by">
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="outline" disabled={!!checking || busy} onClick={checkTop}>
                {checking ? <Loader2 className="animate-spin" /> : <Layers />} Check with nesting engine
              </Button>
              {checking && (
                <>
                  <span className="text-xs text-muted-foreground" role="status">
                    Checking {Math.min(checking.done + 1, checking.total)} of {checking.total}…
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => (stopRef.current = true)}>
                    Stop
                  </Button>
                </>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Candidate layouts">
              {ranked.map((r) => {
                const c = r.cand;
                const m = c.plan.metrics;
                const bad = c.plan.issues.filter((i) => i.severity === "error").length;
                return (
                  <div key={c.id} className="min-w-[200px] shrink-0">
                    <button
                      type="button"
                      role="option"
                      aria-selected={c.id === sel}
                      onClick={() => {
                        setSel(c.id);
                        setEvalSheet(c.sheetIndex);
                        setConfirmed([]);
                        setEditor(newEditor(stateFromInput(c.plan.input)));
                        setSelCut(null);
                        setMode(null);
                        setNotice(null);
                      }}
                      className={`w-full rounded-lg border p-2 text-left text-xs transition-colors ${c.id === sel ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}
                    >
                      <div className="font-semibold">
                        <span className="mr-1 text-muted-foreground">#{r.rank}</span>
                        {c.label}
                        {c.id === sel && editor && isEdited(editor) && (
                          <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">edited</span>
                        )}
                      </div>
                      <div className={`mt-1 font-medium ${r.status === "unnested" ? "text-red-700 dark:text-red-300" : r.sheetsKind === "engine" ? "text-foreground" : "text-muted-foreground"}`}>{sheetsText(r)}</div>
                      <div className="mt-0.5 text-muted-foreground">{candidateFacts({ ...m, sheetsLowerBound: null }).join(" · ")}</div>
                      <div className={`mt-1 font-medium ${bad ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{bad ? `${bad} error${bad > 1 ? "s" : ""}` : "valid"}</div>
                    </button>
                    <label className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                      <Checkbox
                        checked={compare.includes(c.id)}
                        onCheckedChange={(v) => setCompare((l) => (v === true ? (l.includes(c.id) ? l : [...l, c.id].slice(-3)) : l.filter((x) => x !== c.id)))}
                      />
                      Compare
                    </label>
                  </div>
                );
              })}
            </div>
            {explanation && (
              <details className="rounded-lg border border-border p-2 text-xs">
                <summary className="cursor-pointer font-medium">Why this order?</summary>
                <p className="mt-1.5">{explanation.headline}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {explanation.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <p className="mt-2 font-medium">What this does not mean</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {explanation.limits.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </details>
            )}
            {compared.length >= 2 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs" aria-label="Layout comparison">
                  <thead className="bg-secondary text-left text-muted-foreground">
                    <tr>
                      <th className="p-1.5" />
                      {compared.map((r) => (
                        <th key={r.cand.id} className="p-1.5 font-semibold">
                          #{r.rank} {r.cand.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows(compared).map((row) => (
                      <tr key={row.label} className="border-t border-border">
                        <td className="p-1.5 text-muted-foreground">{row.label}</td>
                        {row.cells.map((cell, i) => (
                          <td key={`${row.label}-${i}`} className={`p-1.5 ${row.best.includes(i) ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""}`}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {plan && (
          <>
            {editor && state && bounds && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Edit cuts">
                  <Button size="sm" variant="outline" disabled={!canUndo(editor)} onClick={() => setEditor((ed) => (ed ? undo(ed) : ed))}>
                    <Undo2 /> Undo
                  </Button>
                  <Button size="sm" variant="outline" disabled={!canRedo(editor)} onClick={() => setEditor((ed) => (ed ? redo(ed) : ed))}>
                    <Redo2 /> Redo
                  </Button>
                  <Button size="sm" variant="outline" disabled={!isEdited(editor)} title="Back to the generated proposal" onClick={() => { setEditor((ed) => (ed ? reset(ed) : ed)); setSelCut(null); setNotice(null); }}>
                    <RotateCcw /> Reset
                  </Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <Button size="sm" variant={mode === "strip" ? "default" : "outline"} aria-pressed={mode === "strip"} onClick={() => setMode((m) => (m === "strip" ? null : "strip"))}>
                    <Plus /> Strip cut
                  </Button>
                  <Button size="sm" variant={mode === "seam" ? "default" : "outline"} aria-pressed={mode === "seam"} onClick={() => setMode((m) => (m === "seam" ? null : "seam"))}>
                    <Plus /> Seam
                  </Button>
                  <Button size="sm" variant={mode === "free" ? "default" : "outline"} aria-pressed={mode === "free"} title="Draw a cut line by hand" onClick={() => setMode((m) => (m === "free" ? null : "free"))}>
                    <Pencil /> Free cut
                  </Button>
                  <Button size="sm" variant="outline" disabled={!selCut} onClick={removeSelected}>
                    <Trash2 /> Remove
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={switchDirection}>
                    <ArrowLeftRight /> {state.direction === "H" ? "Vertical" : "Horizontal"}
                  </Button>
                  <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={snapOn} onCheckedChange={(v) => setSnapOn(v === true)} /> Snap
                    <Input className="h-8 w-16" inputMode="decimal" aria-label="Grid size (mm)" value={grid} onChange={(e) => setGrid(e.target.value)} />
                    mm
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {mode === "free"
                    ? "Press on the drawing, drag across the part and release to draw a cut line. Draw as many as you need; click Free cut again (or press Esc) to stop. A line that ends inside the part is extended straight to the edge."
                    : mode
                      ? `Click the drawing to place the ${mode === "strip" ? "strip cut" : "seam"}.`
                      : "Drag a cut line, or select it and use the arrow keys (Shift = ×10). Delete removes it; Ctrl+Z undoes."}
                </p>
                {selCut && selPos !== undefined && (
                  <div className="max-w-[220px]">
                    <Field label={`Position of ${selCut} (mm)`}>
                      <Input
                        key={`${selCut}:${selPos}`}
                        inputMode="decimal"
                        defaultValue={String(Math.round(selPos * 100) / 100)}
                        onKeyDown={(e) => e.key === "Enter" && setPos(e.currentTarget.value)}
                        onBlur={(e) => setPos(e.currentTarget.value)}
                      />
                    </Field>
                  </div>
                )}
                {selCut && isFreeCut(state, selCut) && (
                  <p className="text-[11px] text-muted-foreground">
                    Free cut {selCut}: drag the line to move it, drag a dot to bend it, double-click the line to add a dot and a dot to remove it. Arrow keys nudge it (Shift = ×10).
                  </p>
                )}
                {notice && (
                  <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    {notice}
                  </p>
                )}
              </div>
            )}
            <div tabIndex={0} onKeyDown={onKey} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Layout editor">
              <PlanPreview
                region={gr.region}
                plan={plan}
                edit={
                  state && bounds
                    ? { state, bounds, selected: selCut, mode, onSelect: setSelCut, onDrag, onDragEnd, onAdd, onAddFree, onMoveFreePoint, onMoveFree, onSplitFree, onRemoveFreePoint }
                    : undefined
                }
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-secondary text-left text-muted-foreground">
                  <tr>
                    <th className="p-1.5">Segment</th>
                    <th className="p-1.5">Cut size (mm)</th>
                    <th className="p-1.5">Area (m²)</th>
                    <th className="p-1.5">Fit</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.segments.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-1.5 font-medium">{s.id}</td>
                      <td className="p-1.5">
                        {mm(s.bbox[2] - s.bbox[0])} × {mm(s.bbox[3] - s.bbox[1])}
                      </td>
                      <td className="p-1.5">{(s.finishedArea / 1e6).toFixed(3)}</td>
                      <td className="p-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChip(s.fit.status)}`} title={s.fit.detail}>
                          {s.fit.status === "READY" ? "fits" : s.fit.status === "READY_SOLO" ? "solo sheet" : "does not fit"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[
                ["Segments", String(plan.metrics.segments)],
                ["Seam length", `${(plan.metrics.cutLength / 1000).toFixed(2)} m`],
                ["Sheets (area lower bound)", plan.metrics.sheetsLowerBound === null ? "—" : `≥ ${plan.metrics.sheetsLowerBound}`],
                [plan.metrics.overlapArea < 0 ? "Gap area" : "Overlap area", `${(Math.abs(plan.metrics.overlapArea) / 1e6).toFixed(3)} m²`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border p-2">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="text-sm font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button size="sm" variant="outline" disabled={!plan.valid || (current?.key === planKey && current.result === "busy")} onClick={checkCurrent}>
                <Layers /> Check this layout with the nesting engine
              </Button>
              {current && current.key === planKey && (
                <span role="status" className={current.result !== "busy" && current.result?.unplaced ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}>
                  {current.result === "busy"
                    ? "Nesting…"
                    : current.result === null
                      ? "Could not be checked."
                      : current.result.unplaced > 0
                        ? `${current.result.unplaced} piece(s) could not be nested.`
                        : `${current.result.sheets} sheet${current.result.sheets === 1 ? "" : "s"} · ${(Math.round(current.result.utilization * 10) / 10).toFixed(1)} % used · ${(Math.round(current.result.scrapPct * 10) / 10).toFixed(1)} % scrap (nested on its own, ${group.qty} original${group.qty === 1 ? "" : "s"})`}
                </span>
              )}
            </div>
            {plan.issues.length > 0 && (
              <ul className="space-y-1 text-xs" aria-label="Validation">
                {plan.issues.map((i, k) => (
                  <li
                    key={`${i.code}-${k}`}
                    className={`rounded-md border px-2 py-1 ${
                      i.severity === "error"
                        ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                        : i.severity === "warning"
                          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {i.message}
                    {i.code === "HOLE_CUT_UNCONFIRMED" && i.cutId && (
                      <label className="mt-1 flex items-center gap-2 font-medium">
                        <Checkbox
                          checked={confirmed.includes(i.cutId)}
                          onCheckedChange={(v) => setConfirmed((c) => (v === true ? [...c, i.cutId!] : c.filter((x) => x !== i.cutId)))}
                        />
                        I accept cutting through the hole at {i.cutId}
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="col-span-full flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="max-w-xl text-xs text-muted-foreground" role="status">
          {plan && plan.valid
            ? `Approving creates ${plan.segments.length} part${plan.segments.length === 1 ? "" : "s"} × ${group.qty} pc${group.qty === 1 ? "" : "s"} (${plan.segments.length * group.qty} pieces to nest). The original stays in the list as "Segmented" and keeps its own quantity for the takeoff.`
            : plan
              ? "Fix the errors above to enable approval. Nothing is changed in your nest until you approve."
              : "Nothing is changed in your nest until you approve a layout."}
          {exported && <span className="mt-1 block font-medium text-foreground">{exported}</span>}
        </p>
        <DialogFooterButtons
          onClose={onClose}
          onApprove={plan && plan.valid && !busy && onApprove ? () => onApprove(plan) : undefined}
          onExport={plan && plan.valid && !busy ? doExport : undefined}
          exporting={exporting}
          label={existing ? "Apply changes" : "Approve segmentation"}
        />
      </div>
    </div>
  );
}

function DialogFooterButtons({
  onClose,
  onApprove,
  onExport,
  exporting,
  label,
}: {
  onClose?: () => void;
  onApprove?: () => void;
  onExport?: () => void;
  exporting?: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
      <Button variant="outline" disabled={!onExport || exporting} onClick={onExport} title="Download a zip: a DXF per piece, the assembly drawing and the report">
        {exporting ? <Loader2 className="animate-spin" /> : <Download />} Export
      </Button>
      <Button disabled={!onApprove} onClick={onApprove} title={onApprove ? undefined : "Available when the layout has no errors"}>
        {label}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function SegmentDialog({
  open,
  onOpenChange,
  group,
  nest,
  onApprove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group | null;
  nest: NestCtx;
  /** Receives the part being segmented and the approved plan; the caller creates the pieces. */
  onApprove?: (group: Group, plan: Plan) => void;
}) {
  const existing = group ? savedPlan(group) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit segmentation" : "Segment part"}</DialogTitle>
          <DialogDescription>
            {existing
              ? "The saved cuts are loaded. Change them, then apply — the pieces are re-created and must be nested again."
              : "Split an oversized part into pieces that fit the source sheets. Review the proposed layouts before anything is created."}
          </DialogDescription>
        </DialogHeader>
        {group && (
          <SegmentationPanel
            key={`${group.id}:${group.seg?.planId ?? ""}`}
            group={group}
            nest={nest}
            existing={existing}
            onClose={() => onOpenChange(false)}
            onApprove={onApprove ? (plan) => onApprove(group, plan) : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
