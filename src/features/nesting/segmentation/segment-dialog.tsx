"use client";
/**
 * Segmentation dialog (Phase 5: settings + editable preview).
 *
 * Nothing here changes the nest: the part is only read, layouts are generated and edited on a
 * draft, and closing the dialog discards everything. Creating the segments as parts is a later phase.
 */
import * as React from "react";
import { ArrowLeftRight, Layers, Loader2, Plus, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { makeSettings, type Group } from "../nest-boost/engine";
import { classifyFit } from "./fit";
import {
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
  moveCut,
  newEditor,
  redo,
  removeCut,
  reset,
  stateFromInput,
  toPlanInput,
  undo,
  type Bounds,
  type EditResult,
  type Editor,
  type EditorState,
} from "./editor";
import { candidateFacts, defaultForm, parseForm, planBaseFromForm, type NestCtx, type SegForm } from "./form";
import { regionBBox, regionInteriorPoint } from "./geometry";
import { groupToRegion } from "./group-region";
import { buildPlan, generateCandidates, type Candidate, type Plan } from "./planner";
import { regionPath, screenToWorld, seamLines, segmentFill, segmentStroke, svgViewBox } from "./preview-path";
import type { Region } from "./types";

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
  /** When set, the next press on the drawing adds a cut of that kind. */
  mode: "strip" | "seam" | null;
  onSelect: (id: string | null) => void;
  /** `value` is the new coordinate of the dragged line along its movable axis (world mm). */
  onDrag: (id: string, value: number) => void;
  onDragEnd: () => void;
  onAdd: (kind: "strip" | "seam", at: { across: number; along: number }) => void;
}

const STRIP_COLOR = "hsl(215 90% 55%)";
const SEAM_COLOR = "hsl(280 70% 55%)";

/** Exact-geometry drawing of a plan: original outline, numbered segments, seams, overlap zones; cut lines are draggable when `edit` is given. */
export function PlanPreview({ region, plan, edit }: { region: Region; plan: Plan; edit?: PreviewEdit }) {
  const { box, size } = React.useMemo(() => svgViewBox(region), [region]);
  const labels = React.useMemo(() => plan.segments.map((s) => ({ id: s.id, p: regionInteriorPoint(s.finished) })), [plan]);
  const handles = React.useMemo(() => (edit ? handleLines(edit.state, edit.bounds) : []), [edit]);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const dragging = React.useRef<{ id: string; kind: "strip" | "seam" } | null>(null);
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
        if (edit.mode) {
          const w = world(e);
          edit.onAdd(edit.mode, { across: across(w), along: along(w) });
        } else edit.onSelect(null);
      }}
      onPointerMove={(e) => {
        const d = dragging.current;
        if (!d || !edit) return;
        const w = world(e);
        edit.onDrag(d.id, d.kind === "strip" ? across(w) : along(w));
      }}
      onPointerUp={() => {
        if (dragging.current) {
          dragging.current = null;
          edit?.onDragEnd();
        }
      }}
      onPointerCancel={() => {
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

export function SegmentationPanel({ group, nest: nestProp, onClose }: { group: Group; nest: NestCtx; onClose?: () => void }) {
  // the parent passes a fresh object on every render; depend on the numbers only
  const nest = React.useMemo<NestCtx>(() => ({ W: nestProp.W, H: nestProp.H, mg: nestProp.mg, ro: nestProp.ro }), [nestProp.W, nestProp.H, nestProp.mg, nestProp.ro]);
  const gr = React.useMemo(() => groupToRegion(group), [group]);
  const fit = React.useMemo(() => classifyFit(group, makeSettings({ W: nest.W, H: nest.H, mg: nest.mg, gp: 0, cell: 5, ro: nest.ro })), [group, nest]);

  const [form, setForm] = React.useState<SegForm>(() => defaultForm(nest));
  const [errors, setErrors] = React.useState<string[]>([]);
  const [cands, setCands] = React.useState<Candidate[] | null>(null);
  const [sel, setSel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(true); // the first layouts are generated as soon as the dialog opens
  const [confirmed, setConfirmed] = React.useState<string[]>([]);
  // editing (Phase 5): the draft cut lists with undo/redo, the selected cut, and the active "add" tool
  const [editor, setEditor] = React.useState<Editor | null>(null);
  const [selCut, setSelCut] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"strip" | "seam" | null>(null);
  const [snapOn, setSnapOn] = React.useState(false);
  const [grid, setGrid] = React.useState("10");
  const [notice, setNotice] = React.useState<string | null>(null);
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
    const t = setTimeout(() => run(defaultForm(nest)), 30);
    return () => clearTimeout(t);
  }, [run, nest]);

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
        setEditor((ed) => (ed ? commit(ed, stateFromInput(best.plan.input)) : ed));
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
    if (!selCut || !state || !bounds) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
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
          <p className="text-[11px] text-muted-foreground">If enabled, the cut geometry of neighbouring segments overlaps by this value. Off by default; not a kerf or weld gap.</p>
          {form.overlapOn && (
            <>
              <Field label="Overlap value (mm)">
                <Input inputMode="decimal" placeholder="enter the value for your job" value={form.overlapMm} onChange={(e) => set("overlapMm", e.target.value)} />
              </Field>
              <Field label="Overlap carried by">
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
            <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Candidate layouts">
              {cands.map((c) => {
                const m = c.plan.metrics;
                const bad = c.plan.issues.filter((i) => i.severity === "error").length;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={c.id === sel}
                    onClick={() => {
                      setSel(c.id);
                      setConfirmed([]);
                      setEditor(newEditor(stateFromInput(c.plan.input)));
                      setSelCut(null);
                      setMode(null);
                      setNotice(null);
                    }}
                    className={`min-w-[190px] shrink-0 rounded-lg border p-2 text-left text-xs transition-colors ${
                      c.id === sel ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <div className="font-semibold">
                      {c.label}
                      {c.id === sel && editor && isEdited(editor) && (
                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">edited</span>
                      )}
                    </div>
                    <div className="mt-1 text-muted-foreground">{candidateFacts(m).join(" · ")}</div>
                    <div className={`mt-1 font-medium ${bad ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                      {bad ? `${bad} error${bad > 1 ? "s" : ""}` : "valid"}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Listed by the area-based sheet lower bound, then segment count and seam length. Sheet counts are estimates from area; the nesting engine gives the real number. This order is not a cost optimum.
            </p>
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
                  {mode ? `Click the drawing to place the ${mode === "strip" ? "strip cut" : "seam"}.` : "Drag a cut line, or select it and use the arrow keys (Shift = ×10). Delete removes it; Ctrl+Z undoes."}
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
                    ? { state, bounds, selected: selCut, mode, onSelect: setSelCut, onDrag, onDragEnd, onAdd }
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
                ["Overlap area", `${(plan.metrics.overlapArea / 1e6).toFixed(3)} m²`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border p-2">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="text-sm font-semibold">{v}</div>
                </div>
              ))}
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
        <p className="text-xs text-muted-foreground">Edits are a draft: nothing is changed in your nest. Creating the segments as parts comes in the next phase.</p>
        <DialogFooterButtons onClose={onClose} />
      </div>
    </div>
  );
}

function DialogFooterButtons({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
      <Button disabled title="Creating the segments as parts is added in the next phase">
        Approve segmentation
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group | null;
  nest: NestCtx;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Segment part</DialogTitle>
          <DialogDescription>Split an oversized part into pieces that fit the source sheets. Review the proposed layouts before anything is created.</DialogDescription>
        </DialogHeader>
        {group && <SegmentationPanel key={group.id} group={group} nest={nest} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
