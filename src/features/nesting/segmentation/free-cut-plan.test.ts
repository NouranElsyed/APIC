import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Group } from "../nest-boost/engine";
import { commitSegmentation, removeSegmentation, savedPlan } from "./commit";
import { assemblyDxf } from "./dxf-write";
import {
  addFreeCut,
  boundsFor,
  canUndo,
  commit,
  isFreeCut,
  moveFreeCut,
  moveFreePoint,
  newEditor,
  removeCut,
  removeFreePoint,
  splitFreeSegment,
  stateFromInput,
  toPlanInput,
  undo,
} from "./editor";
import { circleLoop, normalizeRegion, regionArea, regionBBox, regionFromPolygon } from "./geometry";
import { groupToRegion } from "./group-region";
import { buildPlan, type FreeCut, type OverlapSpec, type Plan, type PlanInput } from "./planner";
import { reportData } from "./report";
import { seamLines } from "./preview-path";
import { PlanPreview, SegmentationPanel } from "./segment-dialog";
import type { Pt, Region } from "./types";

/* ---------------- fixtures ---------------- */

const OFF: OverlapSpec = { enabled: false, mm: 0, side: "A" };
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2, gp: 5, cell: 5 };
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  direction: "H",
  stripCuts: [],
  seamCuts: [],
  overlap: OFF,
  sheet: SHEET,
  holePolicy: "reject",
  ...over,
});
const err = (p: Plan) => p.issues.filter((i) => i.severity === "error").map((i) => i.code);
const total = (p: Plan) => p.segments.reduce((s, g) => s + g.finishedArea, 0);

/** A ring (like the part in the screenshot, without the mouth): Ø2800 with a Ø1000 hole. */
const RING: Region = normalizeRegion({ outer: circleLoop(0, 0, 1400), holes: [circleLoop(0, 0, 500, false)] });
const RING_AREA = Math.PI * (1400 * 1400 - 500 * 500);
/** Two hand-drawn lines that bend and cross each other inside the hole. */
const F1: FreeCut = { id: "F1", pts: [[-1600, -80], [-500, 120], [600, -90], [1600, 100]] };
const F2: FreeCut = { id: "F2", pts: [[40, -1600], [-60, 0], [30, 1600]] };
const WARN = { holePolicy: "warn" as const, confirmedHoleCuts: ["F1", "F2"] };

const PLATE: Region = regionFromPolygon([[0, 0], [5000, 0], [5000, 2900], [0, 2900]]);
const FP: FreeCut = { id: "F1", pts: [[2400, -50], [2700, 900], [2300, 2000], [2600, 2950]] };

/* ---------------- planner ---------------- */

describe("buildPlan with free cuts", () => {
  it("cuts a ring with two bent lines that cross: four numbered pieces that add up, with arcs kept", () => {
    const plan = buildPlan(RING, input({ freeCuts: [F1, F2], ...WARN }));
    expect(err(plan)).toEqual([]);
    expect(plan.valid).toBe(true);
    expect(plan.segments.map((s) => s.id)).toEqual(["S01", "S02", "S03", "S04"]);
    expect(total(plan)).toBeCloseTo(RING_AREA, 4);
    expect(plan.segments.every((s) => s.finished.outer.some((e) => e.arc))).toBe(true);
    expect(plan.segments.every((s) => s.cut === s.finished)).toBe(true);
    expect(plan.metrics.cuts).toBe(2);
    expect(plan.metrics.segments).toBe(4);
    // every piece is small enough for the sheet
    expect(plan.segments.every((s) => s.fit.status === "READY")).toBe(true);
  });

  it("reports the seams along the drawn lines, per cut and per pair of pieces", () => {
    const plan = buildPlan(RING, input({ freeCuts: [F1, F2], ...WARN }));
    const free = plan.seams.filter((m) => m.kind === "free");
    expect(free.length).toBeGreaterThanOrEqual(4);
    expect(new Set(free.map((m) => m.cutId))).toEqual(new Set(["F1", "F2"]));
    for (const m of free) {
      expect(m.path!.length).toBeGreaterThan(0);
      expect(m.intervals).toEqual([]);
      expect(m.id).toBe(`${m.cutId}:${m.low}|${m.high}`);
      expect(seamLines(m)).toHaveLength(m.path!.length);
    }
    // a bent line is longer than the straight chord, and the seam length is the sum of the parts
    expect(plan.metrics.cutLength).toBeCloseTo(plan.seams.reduce((s, m) => s + m.length, 0), 6);
    const f1 = free.filter((m) => m.cutId === "F1").reduce((s, m) => s + m.length, 0);
    expect(f1).toBeGreaterThan(2 * (1400 - 500) - 1); // two chords across the material, each at least the ring width
  });

  it("rejects a line through the hole by default and accepts it after confirmation", () => {
    const p = buildPlan(RING, input({ freeCuts: [F1] }));
    expect(err(p)).toContain("HOLE_CUT");
    expect(p.valid).toBe(false);
    const unconfirmed = buildPlan(RING, input({ freeCuts: [F1], holePolicy: "warn" }));
    expect(err(unconfirmed)).toContain("HOLE_CUT_UNCONFIRMED");
    const ok = buildPlan(RING, input({ freeCuts: [F1], holePolicy: "warn", confirmedHoleCuts: ["F1"] }));
    expect(ok.valid).toBe(false); // two halves of a Ø2800 ring still do not fit... but only because of size, not the hole
    expect(err(ok)).not.toContain("HOLE_CUT_UNCONFIRMED");
  });

  it("combines with strip cuts: every strip is cut by the free line and the strip seam is kept", () => {
    const plan = buildPlan(PLATE, input({ stripCuts: [{ id: "C1", pos: 1450 }], freeCuts: [FP] }));
    expect(err(plan)).toEqual([]);
    expect(plan.segments).toHaveLength(4);
    expect(plan.segments.map((s) => s.id)).toEqual(["S01", "S02", "S03", "S04"]);
    expect(total(plan)).toBeCloseTo(5000 * 2900, 4);
    const strip = plan.seams.filter((m) => m.kind === "strip");
    expect(strip.reduce((s, m) => s + m.length, 0)).toBeCloseTo(5000, 6);
    const free = plan.seams.filter((m) => m.kind === "free");
    expect(free).toHaveLength(2); // one per strip
    expect(free.every((m) => m.cutId === "F1")).toBe(true);
    // both halves of the line meet at the strip cut: same x there, so the pieces mate
    expect(plan.metrics.cuts).toBe(2);
  });

  it("an overlap or gap together with free cuts is an error, not silently ignored", () => {
    const p = buildPlan(PLATE, input({ stripCuts: [{ id: "C1", pos: 1450 }], freeCuts: [FP], overlap: { enabled: true, mm: 50, side: "A" } }));
    expect(err(p)).toContain("FREE_CUT_OVERLAP");
    expect(p.valid).toBe(false);
    expect(p.segments.every((s) => s.cut === s.finished)).toBe(true);
  });

  it("a line that crosses itself is reported and ignored; the rest of the plan still draws", () => {
    const bow: FreeCut = { id: "F9", pts: [[0, 0], [100, 100], [100, 0], [0, 100]] };
    const p = buildPlan(PLATE, input({ stripCuts: [{ id: "C1", pos: 1450 }], freeCuts: [bow] }));
    expect(err(p)).toContain("BAD_CUT");
    expect(p.segments).toHaveLength(2);
    expect(p.valid).toBe(false);
  });

  it("a line with fewer than two points is an error", () => {
    const p = buildPlan(PLATE, input({ freeCuts: [{ id: "F1", pts: [[10, 10]] }] }));
    expect(err(p)).toContain("BAD_CUT");
  });

  it("a line that never touches the part says so", () => {
    const miss: FreeCut = { id: "F1", pts: [[9000, 0], [9000, 100]] };
    const p = buildPlan(PLATE, input({ freeCuts: [miss] }));
    expect(err(p)).toContain("CUT_OUTSIDE_PART");
  });

  it("a line drawn only inside the part is extended straight to the edge", () => {
    const short: FreeCut = { id: "F1", pts: [[2500, 800], [2500, 2100]] };
    const p = buildPlan(PLATE, input({ freeCuts: [short] }));
    expect(p.segments).toHaveLength(2);
    expect(total(p)).toBeCloseTo(5000 * 2900, 4);
    expect(p.seams.filter((m) => m.kind === "free").reduce((s, m) => s + m.length, 0)).toBeCloseTo(2900, 4);
  });

  it("moves a line through a vertex by a tiny step and says so", () => {
    const diag: FreeCut = { id: "F1", pts: [[-100, -100], [5100, 3000]] };
    const diagThroughCorners: FreeCut = { id: "F1", pts: [[0, 0], [5000, 2900]] };
    const p = buildPlan(PLATE, input({ freeCuts: [diagThroughCorners] }));
    expect(p.issues.some((i) => i.code === "CUT_SHIFTED")).toBe(true);
    expect(p.segments).toHaveLength(2);
    expect(total(p)).toBeCloseTo(5000 * 2900, 3);
    expect(buildPlan(PLATE, input({ freeCuts: [diag] })).segments).toHaveLength(2);
  });

  it("survives a JSON round trip (what is saved with the part) and gives the same pieces", () => {
    const a = buildPlan(RING, input({ freeCuts: [F1, F2], ...WARN }));
    const b = buildPlan(RING, JSON.parse(JSON.stringify(a.input)));
    expect(b.segments.map((s) => s.id)).toEqual(a.segments.map((s) => s.id));
    expect(b.segments.map((s) => Math.round(s.finishedArea))).toEqual(a.segments.map((s) => Math.round(s.finishedArea)));
  });

  it("plans without free cuts are unchanged (no free-cut keys, same ids)", () => {
    const p = buildPlan(PLATE, input({ stripCuts: [{ id: "C1", pos: 1450 }] }));
    expect(p.segments.map((s) => s.id)).toEqual(["S01", "S02"]);
    expect(p.seams.every((m) => m.kind !== "free" && m.path === undefined)).toBe(true);
    expect("freeCuts" in p.input).toBe(false);
  });

  it("honours the maximum seam length constraint for free seams", () => {
    const p = buildPlan(PLATE, input({ freeCuts: [FP], constraints: { maxSeamLength: 1000 } }));
    expect(err(p)).toContain("SEAM_TOO_LONG");
  });
});

/* ---------------- editor ---------------- */

const base = (): ReturnType<typeof stateFromInput> => stateFromInput(input({ stripCuts: [{ id: "C1", pos: 1450 }] }));
const must = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return (r as unknown as { state: ReturnType<typeof base> }).state;
};

describe("editor: free cuts", () => {
  it("adds a hand-drawn stroke, simplified, with a fresh id", () => {
    const wobble: Pt[] = Array.from({ length: 60 }, (_, i) => [2000 + i * 5, 100 + i * 40 + (i % 2 ? 3 : -3)] as Pt);
    const s = must(addFreeCut(base(), wobble, 20));
    expect(s.freeCuts).toHaveLength(1);
    expect(s.freeCuts[0].id).toBe("F1");
    expect(s.freeCuts[0].pts.length).toBeLessThan(10);
    const s2 = must(addFreeCut(s, [[0, 0], [100, 50]], 1));
    expect(s2.freeCuts.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(isFreeCut(s2, "F2")).toBe(true);
    expect(isFreeCut(s2, "C1")).toBe(false);
  });

  it("refuses a stroke that is too short or crosses itself, with a reason", () => {
    const tooShort = addFreeCut(base(), [[10, 10], [10.2, 10.1]], 1);
    expect(tooShort.ok).toBe(false);
    const loop = addFreeCut(base(), [[0, 0], [100, 100], [100, 0], [0, 100]], 1);
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.reason).toMatch(/cross/i);
  });

  it("snaps the drawn points to the grid when snapping is on", () => {
    const s = must(addFreeCut(base(), [[103, 48], [497, 251]], 1, 50));
    expect(s.freeCuts[0].pts).toEqual([[100, 50], [500, 250]]);
  });

  it("moves a vertex, the whole line, adds a vertex in a segment and removes one", () => {
    let s = must(addFreeCut(base(), [[0, 0], [100, 0], [200, 100]], 1));
    s = must(moveFreePoint(s, "F1", 1, [110, 20]));
    expect(s.freeCuts[0].pts[1]).toEqual([110, 20]);
    s = must(moveFreeCut(s, "F1", 5, -5));
    expect(s.freeCuts[0].pts[0]).toEqual([5, -5]);
    s = must(splitFreeSegment(s, "F1", 0));
    expect(s.freeCuts[0].pts).toHaveLength(4);
    expect(s.freeCuts[0].pts[1]).toEqual([(5 + 115) / 2, (-5 + 15) / 2]);
    s = must(removeFreePoint(s, "F1", 1));
    expect(s.freeCuts[0].pts).toHaveLength(3);
    const two = must(addFreeCut(base(), [[0, 0], [100, 0]], 1));
    expect(removeFreePoint(two, "F1", 0).ok).toBe(false);
    expect(moveFreePoint(two, "nope", 0, [1, 1]).ok).toBe(false);
  });

  it("does not change the state object when nothing moves", () => {
    const s = must(addFreeCut(base(), [[0, 0], [100, 0]], 1));
    expect(moveFreePoint(s, "F1", 0, [0, 0])).toEqual({ ok: true, state: s });
    expect(moveFreeCut(s, "F1", 0, 0)).toEqual({ ok: true, state: s });
  });

  it("removes a free cut with the normal remove, and undo brings it back", () => {
    let ed = newEditor(base());
    ed = commit(ed, must(addFreeCut(ed.present, [[0, 0], [100, 0]], 1)));
    expect(ed.present.freeCuts).toHaveLength(1);
    ed = commit(ed, must(removeCut(ed.present, "F1")));
    expect(ed.present.freeCuts).toHaveLength(0);
    expect(canUndo(ed)).toBe(true);
    ed = undo(ed);
    expect(ed.present.freeCuts).toHaveLength(1);
    expect(removeCut(ed.present, "F7").ok).toBe(false);
  });

  it("keeps the free cuts through stateFromInput / toPlanInput, and leaves the key out when there are none", () => {
    const withFree = stateFromInput(input({ freeCuts: [F1, F2] }));
    expect(withFree.freeCuts.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(withFree.nextF).toBe(3);
    const { direction: _d, stripCuts: _s, seamCuts: _m, freeCuts: _f, ...rest } = input();
    void _d; void _s; void _m; void _f;
    expect(toPlanInput(withFree, rest).freeCuts).toEqual([F1, F2]);
    expect("freeCuts" in toPlanInput(base(), rest)).toBe(false);
    // the copy is deep: editing the state never touches the saved plan
    const src = input({ freeCuts: [{ id: "F1", pts: [[0, 0], [1, 1]] }] });
    const st = stateFromInput(src);
    expect(st.freeCuts[0].pts).not.toBe(src.freeCuts![0].pts);
  });

  it("an edited state feeds buildPlan: drawing, then dragging a vertex changes the pieces", () => {
    const [x0, y0, x1, y1] = regionBBox(PLATE);
    const bounds = boundsFor([x0, y0, x1, y1], "H");
    expect(bounds.across).toEqual([0, 2900]);
    let s = must(addFreeCut(stateFromInput(input()), [[2500, -100], [2500, 3000]], 1));
    const { direction: _d, stripCuts: _s, seamCuts: _m, ...rest } = input();
    void _d; void _s; void _m;
    const a = buildPlan(PLATE, toPlanInput(s, rest));
    expect(a.segments).toHaveLength(2);
    const areaLeft = (p: Plan) => p.segments[0].finishedArea;
    s = must(moveFreeCut(s, "F1", 500, 0));
    const b = buildPlan(PLATE, toPlanInput(s, rest));
    expect(areaLeft(b)).toBeGreaterThan(areaLeft(a));
    expect(total(b)).toBeCloseTo(total(a), 4);
  });
});

/* ---------------- approve, save, export ---------------- */

const plateGroup = (qty = 2): Group => ({
  id: 1, sn: 1, name: "PLATE-001", qty, th: 10, material: "S235",
  outer: [[0, 0], [5000, 0], [5000, 2900], [0, 2900]], holes: [], w: 5000, h: 2900, area: 5000 * 2900, per: 2 * (5000 + 2900),
});

describe("approving and exporting a plan with free cuts", () => {
  const g = plateGroup();
  const region = groupToRegion(g).region;
  const plan = buildPlan(region, input({ stripCuts: [{ id: "C1", pos: 1450 }], freeCuts: [FP] }));

  it("creates one piece per segment and stores the free cuts with the original", () => {
    expect(plan.valid).toBe(true);
    const r = commitSegmentation({ groups: [g], parentId: 1, plan, counters: { id: 100, sn: 10 } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.children.map((c) => c.name)).toEqual(["PLATE-001-S01", "PLATE-001-S02", "PLATE-001-S03", "PLATE-001-S04"]);
    expect(r.children.every((c) => c.qty === 2)).toBe(true);
    expect(r.children.reduce((s, c) => s + c.area, 0)).toBeCloseTo(g.area, 0);
    const saved = savedPlan(JSON.parse(JSON.stringify(r.parent)));
    expect(saved?.freeCuts).toEqual([FP]);
    // re-opening the saved plan gives the same pieces
    const again = buildPlan(region, saved!);
    expect(again.segments.map((s) => s.id)).toEqual(plan.segments.map((s) => s.id));
    // undoing the segmentation restores a plain part
    const undone = removeSegmentation(r.groups, 1);
    expect(undone.groups).toHaveLength(1);
    expect(undone.removedIds).toHaveLength(4);
  });

  it("the report lists the free cut, its seams and the mating edges", () => {
    const d = reportData({ parent: g, original: region, plan, generatedAt: "t" });
    expect(d.summary.find(([k]) => k === "Free-form cuts")?.[1]).toBe(1);
    expect(Math.abs(d.reassemblyDiffMm2)).toBeLessThan(0.01);
    const free = d.seams.filter(({ seam }) => seam.kind === "free");
    expect(free).toHaveLength(2);
    expect(d.pieces.every((p) => p.mating.length > 0)).toBe(true);
    expect(d.pieces.flatMap((p) => p.mating).some((m) => m.kind === "free" && m.line.startsWith("free line"))).toBe(true);
  });

  it("the assembly drawing contains the free seams on the SEAMS layer", () => {
    const dxf = assemblyDxf({ original: region, plan, title: [] });
    const seamSegments = plan.seams.flatMap((m) => seamLines(m)).length;
    const onLayer = dxf.split("\n").filter((l, i, a) => l === "SEAMS" && a[i - 1].trim() === "8").length;
    expect(onLayer).toBeGreaterThanOrEqual(seamSegments);
    // the cut labels are placed on the free seams too
    expect(dxf).toContain("F1");
  });

  it("a ring with free cuts approves too (arcs kept in the pieces)", () => {
    const ringPlan = buildPlan(RING, input({ freeCuts: [F1, F2], ...WARN }));
    const ringGroup: Group = { id: 5, sn: 5, name: "RING", qty: 1, th: 8, material: "S355", outer: [[0, 0], [10, 0], [10, 10]], holes: [], w: 2800, h: 2800, area: RING_AREA, per: 1 };
    const r = commitSegmentation({ groups: [ringGroup], parentId: 5, plan: ringPlan, counters: { id: 200, sn: 20 } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.children).toHaveLength(4);
    expect(regionArea(RING)).toBeCloseTo(RING_AREA, 3);
    expect(r.children.reduce((s, c) => s + c.area, 0)).toBeGreaterThan(RING_AREA * 0.99); // polygons of arcs at 0.1 mm tolerance
    expect(r.children.reduce((s, c) => s + c.area, 0)).toBeLessThan(RING_AREA * 1.001);
  });
});

/* ---------------- dialog render ---------------- */

describe("dialog: free cut tool", () => {
  const g = plateGroup();
  const region = groupToRegion(g).region;
  const plan = buildPlan(region, input({ stripCuts: [{ id: "C1", pos: 1450 }], freeCuts: [FP] }));
  const state = stateFromInput(plan.input);
  const noop = () => undefined;
  const edit = (selected: string | null, mode: "free" | null = null) => ({
    state, bounds: boundsFor(regionBBox(region), "H"), selected, mode,
    onSelect: noop, onDrag: noop, onDragEnd: noop, onAdd: noop, onAddFree: noop, onMoveFreePoint: noop, onMoveFree: noop, onSplitFree: noop, onRemoveFreePoint: noop,
  });

  it("draws the free cut in red with its label, and the seams along it", () => {
    const html = renderToStaticMarkup(createElement(PlanPreview, { region, plan, edit: edit(null) }));
    expect(html).toContain('data-cut="F1"');
    expect(html).toContain("<polyline");
    expect(html).toContain(">F1<");
    for (const s of plan.segments) expect(html).toContain(`>${s.id}<`);
    expect(html).not.toContain("data-vertex"); // dots only when selected
  });

  it("shows a draggable dot on every vertex of the selected free cut", () => {
    const html = renderToStaticMarkup(createElement(PlanPreview, { region, plan, edit: edit("F1") }));
    for (let i = 0; i < FP.pts.length; i++) expect(html).toContain(`data-vertex="F1:${i}"`);
    expect(html).toContain("cursor:move");
  });

  it("the panel offers the Free cut tool and opens a saved plan with its free cuts", () => {
    const html = renderToStaticMarkup(createElement(SegmentationPanel, { group: g, nest: { W: 6000, H: 1500, mg: 5, ro: 2, gp: 5, cell: 5 }, existing: plan.input }));
    expect(html).toContain("Free cut");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-cut="F1"');
    expect(html).toContain("S04");
  });
});
