/**
 * Segmentation Phase 5 — editor model (pure, no React).
 *
 * The editor holds the cut lists of one layout and turns every edit into a new immutable
 * state; the plan (segments, seams, validation) is always re-derived with `buildPlan`, so the
 * preview can never drift from the geometry.
 *
 * Identity: a transverse seam belongs to a STRIP, identified by the strip cut directly below it
 * (null for the first strip). Moving cuts therefore never moves a seam to another strip.
 *
 * Prevented edits (clamped or refused, with a reason): moving a cut past a neighbouring cut or
 * outside the part, adding a cut on top of another or outside the part. Edits that are allowed
 * but make the layout invalid (segment too large, hole crossed, constraint broken) are NOT
 * prevented — `buildPlan` reports them with an explanation, so the user can pass through
 * temporary invalid states while dragging and then correct them.
 */
import { FREE_MIN_SEGMENT, RADIAL_MAX, pathLength, pathSelfIntersects, simplifyPath, type RadialSpec } from "./free-cut";
import type { Direction, FreeCut, PlanInput, StripCut } from "./planner";
import type { Pt } from "./types";

/** Closest two cuts (or a cut and the part's edge) may be, mm. UI rule, not a manufacturing rule. */
export const EDIT_MIN_GAP = 1;

export interface EditSeam {
  id: string;
  /** Id of the strip cut directly below this seam's strip; null = first strip. */
  strip: string | null;
  /** Position along the strip. */
  pos: number;
}

export interface EditorState {
  direction: Direction;
  /** Ascending by position. */
  stripCuts: StripCut[];
  seams: EditSeam[];
  /** Hand-drawn cut lines. They do not belong to a strip: they cut every strip they cross. */
  freeCuts: FreeCut[];
  /** Radial cut (N sectors around a centre), or null. Selected / removed under the id RADIAL_ID. */
  radial: RadialSpec | null;
  nextC: number;
  nextT: number;
  nextF: number;
}

/** The part's extent: `across` = the axis the strip cuts sit on, `along` = the strips' length axis. */
export interface Bounds {
  across: [number, number];
  along: [number, number];
}

export function boundsFor(bbox: [number, number, number, number], direction: Direction): Bounds {
  const [x0, y0, x1, y1] = bbox;
  return direction === "H" ? { across: [y0, y1], along: [x0, x1] } : { across: [x0, x1], along: [y0, y1] };
}

const suffix = (id: string, prefix: string) => {
  const m = new RegExp(`^${prefix}(\\d+)`).exec(id);
  return m ? Number(m[1]) : 0;
};

export function stateFromInput(input: Pick<PlanInput, "direction" | "stripCuts" | "seamCuts" | "freeCuts" | "radial">): EditorState {
  const strips = [...input.stripCuts].sort((a, b) => a.pos - b.pos).map((c) => ({ id: c.id, pos: c.pos }));
  const lower = (i: number) => (i <= 0 ? null : (strips[i - 1]?.id ?? null));
  const seams = input.seamCuts.map((s) => ({ id: s.id, strip: lower(s.strip), pos: s.pos }));
  const freeCuts = (input.freeCuts ?? []).map((f) => ({ id: f.id, pts: f.pts.map((p) => [p[0], p[1]] as Pt) }));
  return {
    direction: input.direction,
    stripCuts: strips,
    seams,
    freeCuts,
    radial: input.radial ? { center: [input.radial.center[0], input.radial.center[1]], count: input.radial.count, startDeg: input.radial.startDeg } : null,
    nextC: Math.max(0, ...strips.map((c) => suffix(c.id, "C"))) + 1,
    nextT: Math.max(0, ...seams.map((t) => suffix(t.id, "T"))) + 1,
    nextF: Math.max(0, ...freeCuts.map((f) => suffix(f.id, "F"))) + 1,
  };
}

/** Plan input for the current state; everything except the cuts comes from `base`. */
export function toPlanInput(state: EditorState, base: Omit<PlanInput, "direction" | "stripCuts" | "seamCuts" | "freeCuts" | "radial">): PlanInput {
  const index = new Map(state.stripCuts.map((c, i) => [c.id, i + 1]));
  return {
    ...base,
    direction: state.direction,
    stripCuts: state.stripCuts.map((c) => ({ ...c })),
    seamCuts: state.seams.map((s) => ({ id: s.id, strip: s.strip === null ? 0 : (index.get(s.strip) ?? 0), pos: s.pos })),
    ...(state.radial ? { radial: { center: [state.radial.center[0], state.radial.center[1]] as Pt, count: state.radial.count, startDeg: state.radial.startDeg } } : {}),
    ...(state.freeCuts.length ? { freeCuts: state.freeCuts.map((f) => ({ id: f.id, pts: f.pts.map((p) => [p[0], p[1]] as Pt) })) } : {}),
  };
}

/** Which strip a coordinate across the part falls in (strip key = lower cut id, null = first). */
export function stripAt(state: EditorState, across: number): string | null {
  const below = state.stripCuts.filter((c) => c.pos < across);
  return below.length ? below[below.length - 1].id : null;
}

/** Across-range [lo, hi] of the strip with key `strip`. */
export function stripRange(state: EditorState, strip: string | null, bounds: Bounds): [number, number] {
  const i = strip === null ? -1 : state.stripCuts.findIndex((c) => c.id === strip);
  const lo = i < 0 ? bounds.across[0] : state.stripCuts[i].pos;
  const hi = i + 1 < state.stripCuts.length ? state.stripCuts[i + 1].pos : bounds.across[1];
  return [lo, hi];
}

export function snap(pos: number, grid?: number): number {
  return grid && grid > 0 ? Math.round(pos / grid) * grid : pos;
}

export type EditResult =
  | { ok: true; state: EditorState; /** Set when the value was held back; explains why. */ note?: string }
  | { ok: false; reason: string };

const r = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function replace<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

/** Moves a strip cut or a seam. The position is snapped, then held inside its allowed range. */
export function moveCut(state: EditorState, id: string, pos: number, bounds: Bounds, grid?: number): EditResult {
  if (!Number.isFinite(pos)) return { ok: false, reason: "Enter a valid position." };
  const g = EDIT_MIN_GAP;
  const ci = state.stripCuts.findIndex((c) => c.id === id);
  if (ci >= 0) {
    const prev = ci === 0 ? undefined : state.stripCuts[ci - 1];
    const next = ci === state.stripCuts.length - 1 ? undefined : state.stripCuts[ci + 1];
    const lo = (prev ? prev.pos : bounds.across[0]) + g;
    const hi = (next ? next.pos : bounds.across[1]) - g;
    if (lo > hi) return { ok: false, reason: `There is no room to move ${id} between its neighbours.` };
    const want = snap(pos, grid);
    const p = clamp(want, lo, hi);
    if (p === state.stripCuts[ci].pos) return { ok: true, state, ...(p !== want ? { note: noteFor(id, want, lo, hi, prev?.id, next?.id) } : {}) };
    return {
      ok: true,
      state: { ...state, stripCuts: replace(state.stripCuts, id, { pos: p }) },
      ...(p !== want ? { note: noteFor(id, want, lo, hi, prev?.id, next?.id) } : {}),
    };
  }
  const seam = state.seams.find((s) => s.id === id);
  if (!seam) return { ok: false, reason: `Cut ${id} does not exist.` };
  const others = state.seams.filter((s) => s.strip === seam.strip && s.id !== id);
  const below = others.filter((s) => s.pos < seam.pos).sort((a, b) => b.pos - a.pos)[0];
  const above = others.filter((s) => s.pos > seam.pos).sort((a, b) => a.pos - b.pos)[0];
  const lo = (below ? below.pos : bounds.along[0]) + g;
  const hi = (above ? above.pos : bounds.along[1]) - g;
  if (lo > hi) return { ok: false, reason: `There is no room to move ${id} between its neighbours.` };
  const want = snap(pos, grid);
  const p = clamp(want, lo, hi);
  const note = p !== want ? noteFor(id, want, lo, hi, below?.id, above?.id) : undefined;
  if (p === seam.pos) return { ok: true, state, ...(note ? { note } : {}) };
  return { ok: true, state: { ...state, seams: replace(state.seams, id, { pos: p }) }, ...(note ? { note } : {}) };
}

function noteFor(id: string, want: number, lo: number, hi: number, below?: string, above?: string): string {
  const atLow = want < lo;
  const neighbour = atLow ? below : above;
  return `${id} was held at ${r(atLow ? lo : hi)} mm: ${neighbour ? `it must stay ${EDIT_MIN_GAP} mm from ${neighbour}` : `it must stay inside the part`}.`;
}

/** Adds a strip cut at `pos`. A strip that is split gives its seams to both halves. */
export function addStripCut(state: EditorState, pos: number, bounds: Bounds, grid?: number): EditResult {
  if (!Number.isFinite(pos)) return { ok: false, reason: "Enter a valid position." };
  const p = snap(pos, grid);
  const [lo, hi] = bounds.across;
  if (p < lo + EDIT_MIN_GAP || p > hi - EDIT_MIN_GAP) {
    return { ok: false, reason: `A cut at ${r(p)} mm would be outside the part (${r(lo)}–${r(hi)} mm).` };
  }
  const near = state.stripCuts.find((c) => Math.abs(c.pos - p) < EDIT_MIN_GAP);
  if (near) return { ok: false, reason: `A cut at ${r(p)} mm would be on top of ${near.id} (minimum distance ${EDIT_MIN_GAP} mm).` };

  let id = `C${state.nextC}`;
  let n = state.nextC;
  while (state.stripCuts.some((c) => c.id === id)) id = `C${++n}`;
  const split = stripAt(state, p); // the strip being divided keeps its lower half
  const copies: EditSeam[] = [];
  let nextT = state.nextT;
  for (const s of state.seams.filter((x) => x.strip === split)) {
    let tid = `T${nextT++}`;
    while (state.seams.some((x) => x.id === tid)) tid = `T${nextT++}`;
    copies.push({ id: tid, strip: id, pos: s.pos });
  }
  const stripCuts = [...state.stripCuts, { id, pos: p }].sort((a, b) => a.pos - b.pos);
  return { ok: true, state: { ...state, stripCuts, seams: [...state.seams, ...copies], nextC: n + 1, nextT } };
}

/** Adds a transverse seam in the strip containing `across`, at `pos` along the strip. */
export function addSeam(state: EditorState, across: number, pos: number, bounds: Bounds, grid?: number): EditResult {
  if (!Number.isFinite(pos) || !Number.isFinite(across)) return { ok: false, reason: "Enter a valid position." };
  const strip = stripAt(state, across);
  const p = snap(pos, grid);
  const [lo, hi] = bounds.along;
  if (p < lo + EDIT_MIN_GAP || p > hi - EDIT_MIN_GAP) {
    return { ok: false, reason: `A seam at ${r(p)} mm would be outside the part (${r(lo)}–${r(hi)} mm).` };
  }
  const near = state.seams.find((s) => s.strip === strip && Math.abs(s.pos - p) < EDIT_MIN_GAP);
  if (near) return { ok: false, reason: `A seam at ${r(p)} mm would be on top of ${near.id} (minimum distance ${EDIT_MIN_GAP} mm).` };
  let n = state.nextT;
  let id = `T${n}`;
  while (state.seams.some((s) => s.id === id)) id = `T${++n}`;
  return { ok: true, state: { ...state, seams: [...state.seams, { id, strip, pos: p }], nextT: n + 1 } };
}

/** Removes a strip cut (its strip merges with the one below) or a seam. */
export function removeCut(state: EditorState, id: string): EditResult {
  if (id === RADIAL_ID && state.radial) return { ok: true, state: { ...state, radial: null } };
  if (state.freeCuts.some((f) => f.id === id)) return { ok: true, state: { ...state, freeCuts: state.freeCuts.filter((f) => f.id !== id) } };
  const ci = state.stripCuts.findIndex((c) => c.id === id);
  if (ci >= 0) {
    const target = ci === 0 ? null : state.stripCuts[ci - 1].id;
    const kept = state.seams.filter((s) => s.strip !== id);
    const moved: EditSeam[] = [];
    for (const s of state.seams.filter((x) => x.strip === id)) {
      const clash = [...kept, ...moved].some((o) => o.strip === target && Math.abs(o.pos - s.pos) < EDIT_MIN_GAP);
      if (!clash) moved.push({ ...s, strip: target });
    }
    return { ok: true, state: { ...state, stripCuts: state.stripCuts.filter((c) => c.id !== id), seams: [...kept, ...moved] } };
  }
  if (!state.seams.some((s) => s.id === id)) return { ok: false, reason: `Cut ${id} does not exist.` };
  return { ok: true, state: { ...state, seams: state.seams.filter((s) => s.id !== id) } };
}

/** The cut's current position, or undefined. */
export function cutPos(state: EditorState, id: string): number | undefined {
  return state.stripCuts.find((c) => c.id === id)?.pos ?? state.seams.find((s) => s.id === id)?.pos;
}

/* ---- free-form cuts ------------------------------------------------ */

/* ---- radial cut ------------------------------------------------------ */

/** Id under which the radial cut is selected and removed. */
export const RADIAL_ID = "R";
export const DEFAULT_RADIAL_COUNT = 4;

export const isRadial = (state: EditorState, id: string | null | undefined): boolean => id === RADIAL_ID && !!state.radial;

/**
 * Creates the radial cut (centre + number of divisions + start angle) or changes some of its values.
 * A new one starts with 4 divisions and a start angle of 0°.
 */
export function setRadial(state: EditorState, patch: Partial<RadialSpec>): EditResult {
  const cur: RadialSpec = state.radial ?? { center: [0, 0], count: DEFAULT_RADIAL_COUNT, startDeg: 0 };
  const next: RadialSpec = { center: patch.center ?? cur.center, count: patch.count ?? cur.count, startDeg: patch.startDeg ?? cur.startDeg };
  if (!Number.isFinite(next.center[0]) || !Number.isFinite(next.center[1])) return { ok: false, reason: "Enter a valid centre (X and Y in mm)." };
  if (!Number.isInteger(next.count) || next.count < 2 || next.count > RADIAL_MAX) return { ok: false, reason: `The number of divisions must be a whole number from 2 to ${RADIAL_MAX}.` };
  if (!Number.isFinite(next.startDeg)) return { ok: false, reason: "Enter a valid start angle in degrees." };
  const same = state.radial && state.radial.count === next.count && state.radial.startDeg === next.startDeg && state.radial.center[0] === next.center[0] && state.radial.center[1] === next.center[1];
  if (same) return { ok: true, state };
  return { ok: true, state: { ...state, radial: { center: [next.center[0], next.center[1]], count: next.count, startDeg: next.startDeg } } };
}

/** Moves the centre of the radial cut (snapped to the grid when snapping is on). */
export function moveRadialCenter(state: EditorState, to: Pt, grid?: number): EditResult {
  return setRadial(state, { center: [snap(to[0], grid), snap(to[1], grid)] });
}

export const isFreeCut = (state: EditorState, id: string | null | undefined): boolean => !!id && state.freeCuts.some((f) => f.id === id);

/**
 * Adds a hand-drawn cut. `raw` is the stroke as drawn (many points); it is simplified to a polyline whose
 * deviation from the stroke is at most `tolMm`. Refused: fewer than two different points, or a line that crosses itself.
 */
export function addFreeCut(state: EditorState, raw: Pt[], tolMm: number, grid?: number): EditResult {
  const pts = simplifyPath(raw.map((p) => [snap(p[0], grid), snap(p[1], grid)] as Pt), tolMm);
  if (pts.length < 2 || pathLength(pts) < EDIT_MIN_GAP) return { ok: false, reason: "That line is too short to be a cut. Press, drag across the part and release." };
  if (pathSelfIntersects(pts)) return { ok: false, reason: "A free cut cannot cross itself. Draw it again as a line that does not cross itself." };
  let n = state.nextF;
  let id = `F${n}`;
  while (state.freeCuts.some((f) => f.id === id)) id = `F${++n}`;
  return { ok: true, state: { ...state, freeCuts: [...state.freeCuts, { id, pts }], nextF: n + 1 } };
}

/** Moves one vertex of a free cut. Crossing itself is allowed while dragging: the plan reports it (and ignores that cut). */
export function moveFreePoint(state: EditorState, id: string, index: number, to: Pt, grid?: number): EditResult {
  const cut = state.freeCuts.find((f) => f.id === id);
  if (!cut || index < 0 || index >= cut.pts.length) return { ok: false, reason: `Cut ${id} does not exist.` };
  if (!Number.isFinite(to[0]) || !Number.isFinite(to[1])) return { ok: false, reason: "Enter a valid position." };
  const p: Pt = [snap(to[0], grid), snap(to[1], grid)];
  if (p[0] === cut.pts[index][0] && p[1] === cut.pts[index][1]) return { ok: true, state };
  const pts = cut.pts.map((q, i) => (i === index ? p : q));
  return { ok: true, state: { ...state, freeCuts: state.freeCuts.map((f) => (f.id === id ? { ...f, pts } : f)) } };
}

/** Moves a whole free cut by (dx, dy) mm. */
export function moveFreeCut(state: EditorState, id: string, dx: number, dy: number): EditResult {
  const cut = state.freeCuts.find((f) => f.id === id);
  if (!cut) return { ok: false, reason: `Cut ${id} does not exist.` };
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, reason: "Enter a valid position." };
  if (dx === 0 && dy === 0) return { ok: true, state };
  const pts = cut.pts.map((q) => [q[0] + dx, q[1] + dy] as Pt);
  return { ok: true, state: { ...state, freeCuts: state.freeCuts.map((f) => (f.id === id ? { ...f, pts } : f)) } };
}

/** Adds a vertex in the middle of segment `index` → `index + 1` (to make a straight stretch bendable). */
export function splitFreeSegment(state: EditorState, id: string, index: number): EditResult {
  const cut = state.freeCuts.find((f) => f.id === id);
  if (!cut || index < 0 || index + 1 >= cut.pts.length) return { ok: false, reason: `Cut ${id} does not exist.` };
  const [a, b] = [cut.pts[index], cut.pts[index + 1]];
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2 * FREE_MIN_SEGMENT) return { ok: false, reason: "That stretch is too short to split." };
  const pts = [...cut.pts.slice(0, index + 1), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt, ...cut.pts.slice(index + 1)];
  return { ok: true, state: { ...state, freeCuts: state.freeCuts.map((f) => (f.id === id ? { ...f, pts } : f)) } };
}

/** Removes one vertex of a free cut (a cut keeps at least two). */
export function removeFreePoint(state: EditorState, id: string, index: number): EditResult {
  const cut = state.freeCuts.find((f) => f.id === id);
  if (!cut || index < 0 || index >= cut.pts.length) return { ok: false, reason: `Cut ${id} does not exist.` };
  if (cut.pts.length <= 2) return { ok: false, reason: "A free cut needs at least two points. Remove the whole cut instead." };
  const pts = cut.pts.filter((_, i) => i !== index);
  return { ok: true, state: { ...state, freeCuts: state.freeCuts.map((f) => (f.id === id ? { ...f, pts } : f)) } };
}

export interface HandleLine {
  id: string;
  kind: "strip" | "seam";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Where to draw the label (world coordinates). */
  label: [number, number];
}

/** Draggable lines for every cut, in world coordinates. Strip cuts span the part, seams span their strip. */
export function handleLines(state: EditorState, bounds: Bounds): HandleLine[] {
  const H = state.direction === "H";
  const line = (kind: HandleLine["kind"], id: string, across: [number, number], along: [number, number], atAcross?: number, atAlong?: number): HandleLine => {
    // strip cut: constant `across`, spans `along`; seam: constant `along`, spans `across`
    const [x1, y1, x2, y2] =
      kind === "strip"
        ? H ? [along[0], atAcross!, along[1], atAcross!] : [atAcross!, along[0], atAcross!, along[1]]
        : H ? [atAlong!, across[0], atAlong!, across[1]] : [across[0], atAlong!, across[1], atAlong!];
    return { id, kind, x1, y1, x2, y2, label: [x1, y1] };
  };
  return [
    ...state.stripCuts.map((c) => line("strip", c.id, bounds.across, bounds.along, c.pos)),
    ...state.seams.map((s) => line("seam", s.id, stripRange(state, s.strip, bounds), bounds.along, undefined, s.pos)),
  ];
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const MAX_HISTORY = 100;

export interface Editor {
  present: EditorState;
  past: EditorState[];
  future: EditorState[];
  /** The automatically generated proposal "Reset" returns to. */
  initial: EditorState;
  /** Key of the gesture in progress (a drag), so its many moves become one undo step. */
  gesture: string | null;
}

export const newEditor = (state: EditorState): Editor => ({ present: state, past: [], future: [], initial: state, gesture: null });

/** Makes `next` the present state. Edits with the same `gesture` key as the previous one replace it instead of stacking. */
export function commit(ed: Editor, next: EditorState, gesture?: string): Editor {
  if (next === ed.present) return ed;
  if (gesture && ed.gesture === gesture) return { ...ed, present: next };
  return { ...ed, past: [...ed.past, ed.present].slice(-MAX_HISTORY), future: [], present: next, gesture: gesture ?? null };
}

export const endGesture = (ed: Editor): Editor => (ed.gesture ? { ...ed, gesture: null } : ed);

export const canUndo = (ed: Editor) => ed.past.length > 0;
export const canRedo = (ed: Editor) => ed.future.length > 0;

export function undo(ed: Editor): Editor {
  if (!ed.past.length) return ed;
  return { ...ed, present: ed.past[ed.past.length - 1], past: ed.past.slice(0, -1), future: [ed.present, ...ed.future], gesture: null };
}

export function redo(ed: Editor): Editor {
  if (!ed.future.length) return ed;
  return { ...ed, present: ed.future[0], past: [...ed.past, ed.present], future: ed.future.slice(1), gesture: null };
}

/** Back to the generated proposal (itself undoable). */
export const reset = (ed: Editor): Editor => commit(endGesture(ed), ed.initial);

/** True when the user changed something compared with the proposal. */
export const isEdited = (ed: Editor) => ed.present !== ed.initial;
