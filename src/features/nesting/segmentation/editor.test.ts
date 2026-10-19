import { describe, expect, it } from "vitest";
import {
  EDIT_MIN_GAP,
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
  snap,
  stateFromInput,
  stripAt,
  stripRange,
  toPlanInput,
  undo,
  type EditResult,
  type EditorState,
} from "./editor";
import { circleLoop, regionBBox, regionFromPolygon } from "./geometry";
import { buildPlan, generateCandidates } from "./planner";
import { screenToWorld, svgViewBox } from "./preview-path";
import { planBaseFromForm, defaultForm } from "./form";
import type { Pt, Region } from "./types";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 };
const base = { overlap: { enabled: false, mm: 0, side: "A" as const }, sheet: SHEET, holePolicy: "reject" as const };

const ok = (r: EditResult): EditorState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

/** 12000 × 2980 plate, horizontal strips: 2 strips with 3 pieces each. */
const plate: Region = regionFromPolygon(rect(0, 0, 12000, 2980));
const B = boundsFor(regionBBox(plate), "H");
const start = (): EditorState =>
  stateFromInput({
    direction: "H",
    stripCuts: [{ id: "C1", pos: 1490 }],
    seamCuts: [
      { id: "T1.1", strip: 0, pos: 4000 },
      { id: "T1.2", strip: 0, pos: 8000 },
      { id: "T2.1", strip: 1, pos: 3000 },
      { id: "T2.2", strip: 1, pos: 6500 },
    ],
  });

describe("state ↔ plan input", () => {
  it("round-trips and keys seams to the strip's lower cut", () => {
    const s = start();
    expect(s.seams.map((x) => [x.id, x.strip])).toEqual([["T1.1", null], ["T1.2", null], ["T2.1", "C1"], ["T2.2", "C1"]]);
    const input = toPlanInput(s, base);
    expect(input.stripCuts).toEqual([{ id: "C1", pos: 1490 }]);
    expect(input.seamCuts.map((c) => [c.id, c.strip, c.pos])).toEqual([["T1.1", 0, 4000], ["T1.2", 0, 8000], ["T2.1", 1, 3000], ["T2.2", 1, 6500]]);
    expect(s.nextC).toBe(2);
    expect(s.nextT).toBe(3);
  });

  it("finds strips and their ranges", () => {
    const s = start();
    expect(stripAt(s, 100)).toBeNull();
    expect(stripAt(s, 2000)).toBe("C1");
    expect(stripRange(s, null, B)).toEqual([0, 1490]);
    expect(stripRange(s, "C1", B)).toEqual([1490, 2980]);
  });
});

describe("moveCut", () => {
  it("moves a strip cut and a seam", () => {
    const s = ok(moveCut(start(), "C1", 1200, B));
    expect(cutPos(s, "C1")).toBe(1200);
    expect(cutPos(ok(moveCut(s, "T1.1", 3500, B)), "T1.1")).toBe(3500);
  });

  it("snaps to the grid when asked", () => {
    expect(snap(1234, 50)).toBe(1250);
    expect(snap(1234)).toBe(1234);
    expect(cutPos(ok(moveCut(start(), "C1", 1234, B, 50)), "C1")).toBe(1250);
  });

  it("holds a cut inside the part and explains why", () => {
    const r = moveCut(start(), "C1", 99999, B);
    expect(r.ok && r.state.stripCuts[0].pos).toBe(2980 - EDIT_MIN_GAP);
    expect(r.ok && r.note).toMatch(/held at 2979/);
    expect(r.ok && cutPos(r.state, "C1")).toBe(2979);
  });

  it("a seam cannot pass its neighbour or leave the part", () => {
    const r = moveCut(start(), "T1.1", 9000, B); // T1.2 is at 8000
    expect(r.ok && cutPos(r.state, "T1.1")).toBe(8000 - EDIT_MIN_GAP);
    expect(r.ok && r.note).toContain("T1.2");
    const r2 = moveCut(start(), "T1.1", -50, B);
    expect(r2.ok && cutPos(r2.state, "T1.1")).toBe(EDIT_MIN_GAP);
  });

  it("strip cuts keep their order", () => {
    const s = ok(addStripCut(start(), 2200, B));
    const r = moveCut(s, "C1", 2500, B); // C2 at 2200
    expect(r.ok && cutPos(r.state, "C1")).toBe(2200 - EDIT_MIN_GAP);
  });

  it("a move to the same place is a no-op (same object, no history entry)", () => {
    const s = start();
    const r = moveCut(s, "C1", 1490, B);
    expect(r.ok && r.state).toBe(s);
  });

  it("rejects unknown ids and non-numbers", () => {
    expect(moveCut(start(), "Cx", 5, B).ok).toBe(false);
    expect(moveCut(start(), "C1", NaN, B).ok).toBe(false);
  });

  it("moving a strip cut keeps every seam in its strip", () => {
    const s = ok(moveCut(start(), "C1", 600, B));
    const input = toPlanInput(s, base);
    expect(input.seamCuts.filter((c) => c.strip === 1).map((c) => c.id)).toEqual(["T2.1", "T2.2"]);
  });
});

describe("addStripCut / addSeam / removeCut", () => {
  it("adds a strip cut and gives the split strip's seams to both halves", () => {
    const r = addStripCut(start(), 700, B);
    const s = ok(r);
    expect(s.stripCuts.map((c) => [c.id, c.pos])).toEqual([["C2", 700], ["C1", 1490]]);
    // first strip was split at 700: the new upper part (lower cut C2) inherits copies of T1.1 / T1.2
    const upper = s.seams.filter((x) => x.strip === "C2");
    expect(upper.map((x) => x.pos).sort((a, b) => a - b)).toEqual([4000, 8000]);
    expect(new Set(s.seams.map((x) => x.id)).size).toBe(s.seams.length); // unique ids
    // strip below C1 (the middle strip now) keeps the originals; C1's strip is untouched
    expect(s.seams.filter((x) => x.strip === null).map((x) => x.pos)).toEqual([4000, 8000]);
    expect(s.seams.filter((x) => x.strip === "C1")).toHaveLength(2);
  });

  it("refuses cuts outside the part or on top of another cut, with a reason", () => {
    const a = addStripCut(start(), 5000, B);
    expect(!a.ok && a.reason).toMatch(/outside the part/);
    const b = addStripCut(start(), 1490.4, B);
    expect(!b.ok && b.reason).toMatch(/on top of C1/);
    const c = addSeam(start(), 100, 4000.5, B);
    expect(!c.ok && c.reason).toMatch(/on top of T1.1/);
    const d = addSeam(start(), 100, 99999, B);
    expect(!d.ok && d.reason).toMatch(/outside the part/);
  });

  it("adds a seam to the strip that was clicked", () => {
    const s = ok(addSeam(start(), 2200, 9000, B));
    const added = s.seams[s.seams.length - 1];
    expect(added.strip).toBe("C1");
    expect(added.pos).toBe(9000);
    expect(added.id).toBe("T3");
    const again = ok(addSeam(s, 100, 5000, B));
    expect(again.seams[again.seams.length - 1]).toMatchObject({ strip: null, pos: 5000, id: "T4" });
  });

  it("removes a seam, or a strip cut (its strip merges with the one below, duplicate seams dropped)", () => {
    expect(ok(removeCut(start(), "T1.1")).seams.map((x) => x.id)).toEqual(["T1.2", "T2.1", "T2.2"]);
    const merged = ok(removeCut(start(), "C1"));
    expect(merged.stripCuts).toHaveLength(0);
    expect(merged.seams.every((x) => x.strip === null)).toBe(true);
    expect(merged.seams.map((x) => x.pos).sort((a, b) => a - b)).toEqual([3000, 4000, 6500, 8000]); // all four differ, none lost
    // a seam that lands within the minimum gap of an existing one is dropped
    const aligned = stateFromInput({
      direction: "H",
      stripCuts: [{ id: "C1", pos: 1490 }],
      seamCuts: [{ id: "T1.1", strip: 0, pos: 4000 }, { id: "T2.1", strip: 1, pos: 4000.2 }],
    });
    expect(ok(removeCut(aligned, "C1")).seams.map((x) => x.id)).toEqual(["T1.1"]);
    expect(removeCut(start(), "nope").ok).toBe(false);
  });
});

describe("handle lines", () => {
  it("horizontal strips: strip cuts are horizontal, seams vertical and limited to their strip", () => {
    const h = handleLines(start(), B);
    const c1 = h.find((x) => x.id === "C1")!;
    expect(c1).toMatchObject({ kind: "strip", x1: 0, y1: 1490, x2: 12000, y2: 1490 });
    const t11 = h.find((x) => x.id === "T1.1")!;
    expect(t11).toMatchObject({ kind: "seam", x1: 4000, y1: 0, x2: 4000, y2: 1490 });
    const t21 = h.find((x) => x.id === "T2.1")!;
    expect(t21).toMatchObject({ x1: 3000, y1: 1490, x2: 3000, y2: 2980 });
  });

  it("vertical strips swap the axes", () => {
    const v = stateFromInput({ direction: "V", stripCuts: [{ id: "C1", pos: 5000 }], seamCuts: [{ id: "T1.1", strip: 0, pos: 1000 }] });
    const h = handleLines(v, boundsFor(regionBBox(plate), "V"));
    expect(h.find((x) => x.id === "C1")).toMatchObject({ x1: 5000, y1: 0, x2: 5000, y2: 2980 });
    expect(h.find((x) => x.id === "T1.1")).toMatchObject({ x1: 0, y1: 1000, x2: 5000, y2: 1000 });
  });
});

describe("history", () => {
  const e0 = newEditor(start());
  const move = (e: typeof e0, id: string, pos: number, gesture?: string) => commit(e, ok(moveCut(e.present, id, pos, B)), gesture);

  it("undo / redo walk through edits", () => {
    let e = move(e0, "C1", 1000);
    e = move(e, "C1", 900);
    expect(e.past).toHaveLength(2);
    expect(canUndo(e)).toBe(true);
    e = undo(e);
    expect(cutPos(e.present, "C1")).toBe(1000);
    e = undo(e);
    expect(cutPos(e.present, "C1")).toBe(1490);
    expect(canUndo(e)).toBe(false);
    expect(undo(e)).toBe(e);
    expect(canRedo(e)).toBe(true);
    e = redo(redo(e));
    expect(cutPos(e.present, "C1")).toBe(900);
    expect(redo(e)).toBe(e);
  });

  it("a new edit clears the redo stack", () => {
    let e = move(e0, "C1", 1000);
    e = undo(e);
    expect(canRedo(e)).toBe(true);
    e = move(e, "C1", 1200);
    expect(canRedo(e)).toBe(false);
  });

  it("a whole drag is ONE undo step", () => {
    let e = e0;
    for (const p of [1480, 1450, 1400, 1300, 1200]) e = move(e, "C1", p, "drag:C1");
    e = endGesture(e);
    expect(e.past).toHaveLength(1);
    expect(cutPos(undo(e).present, "C1")).toBe(1490);
    // the next drag is a new step
    e = move(e, "C1", 1100, "drag:C1");
    expect(e.past).toHaveLength(2);
  });

  it("reset returns to the proposal and is itself undoable; isEdited tracks it", () => {
    let e = move(move(e0, "C1", 1000), "T1.1", 3000);
    expect(isEdited(e)).toBe(true);
    e = reset(e);
    expect(e.present).toBe(e.initial);
    expect(isEdited(e)).toBe(false);
    expect(reset(e)).toBe(e); // nothing to reset
    e = undo(e);
    expect(cutPos(e.present, "T1.1")).toBe(3000);
    expect(isEdited(undo(undo(e)))).toBe(false); // back at the proposal
  });

  it("history is capped", () => {
    let e = e0;
    for (let i = 0; i < 150; i++) e = move(e, "C1", 1000 + i);
    expect(e.past.length).toBe(100);
  });
});

describe("live validation of edits (buildPlan on the edited state)", () => {
  const sheet = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 };
  const plan = (s: EditorState) => buildPlan(plate, toPlanInput(s, { ...base, sheet }));
  const errors = (s: EditorState) => plan(s).issues.filter((i) => i.severity === "error");

  it("the starting layout is valid", () => {
    expect(plan(start()).valid).toBe(true);
    expect(plan(start()).segments).toHaveLength(6);
  });

  it("dragging a strip cut until a strip no longer fits is reported, with the segment and its size", () => {
    const s = ok(moveCut(start(), "C1", 1600, B)); // strip 1 becomes 1600 high > 1490
    const e = errors(s);
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((i) => i.code === "SEGMENT_TOO_LARGE")).toBe(true);
    expect(e[0].message).toMatch(/does not fit/);
    // dragging it back fixes it
    expect(plan(ok(moveCut(s, "C1", 1490, B))).valid).toBe(true);
  });

  it("moving a seam so a piece gets too long is reported", () => {
    const s = ok(moveCut(start(), "T1.1", 6500, B)); // first piece 6500 > 5990
    expect(errors(s).map((i) => i.code)).toContain("SEGMENT_TOO_LARGE");
  });

  it("removing a seam leaves a piece too long", () => {
    expect(errors(ok(removeCut(start(), "T1.2"))).map((i) => i.code)).toContain("SEGMENT_TOO_LARGE");
  });

  it("adding a strip cut inherits seams, so the layout stays valid and the pieces still cover the part", () => {
    const s = ok(addStripCut(start(), 700, B));
    const p = plan(s);
    expect(p.valid).toBe(true);
    expect(p.metrics.finishedArea).toBeCloseTo(12000 * 2980, 3);
  });

  it("a cut through a hole is flagged as the user drags it over the hole", () => {
    const holed = regionFromPolygon(rect(0, 0, 12000, 2980), [rect(3900, 100, 4100, 300)]);
    const s = stateFromInput({ direction: "H", stripCuts: [{ id: "C1", pos: 1490 }], seamCuts: [{ id: "T1.1", strip: 0, pos: 5000 }, { id: "T1.2", strip: 0, pos: 10000 }] });
    const p = (st: EditorState) => buildPlan(holed, toPlanInput(st, { ...base, sheet }));
    expect(p(s).issues.some((i) => i.code === "HOLE_CUT")).toBe(false);
    const dragged = ok(moveCut(s, "T1.1", 4000, B)); // through the hole at x 3900–4100
    expect(p(dragged).issues.some((i) => i.code === "HOLE_CUT")).toBe(true);
    expect(p(dragged).valid).toBe(false);
  });

  it("edits work on a generated layout for a circle with exact arcs", () => {
    const circle: Region = { outer: circleLoop(0, 0, 3760), holes: [] };
    const best = generateCandidates(circle, { directions: ["H"], sheet, overlap: base.overlap, holePolicy: "reject", allowSolo: false }).find((c) => c.plan.valid)!;
    const st = stateFromInput(best.plan.input);
    const b = boundsFor(regionBBox(circle), "H");
    expect(plan2(circle, st, sheet).valid).toBe(true);
    // drag the middle cut up by 300 mm: still a valid partition (area exact) even if some pieces no longer fit
    const mid = st.stripCuts[Math.floor(st.stripCuts.length / 2)];
    const moved = ok(moveCut(st, mid.id, mid.pos + 300, b));
    const p = plan2(circle, moved, sheet);
    expect(p.metrics.finishedArea).toBeCloseTo(Math.PI * 3760 * 3760, 2);
    for (const s of p.segments) expect(s.finished.outer.some((e) => e.arc)).toBe(true);
  });

  it("settings edited in the form re-validate the same cuts (overlap value missing → clear error)", () => {
    const f = { ...defaultForm({ W: 6000, H: 1500 }), overlapOn: true };
    const p = buildPlan(plate, toPlanInput(start(), planBaseFromForm(f, { mg: 5, ro: 2 })));
    expect(p.issues.map((i) => i.code)).toContain("INVALID_OVERLAP");
    const withValue = buildPlan(plate, toPlanInput(start(), planBaseFromForm({ ...f, overlapMm: "40" }, { mg: 5, ro: 2 })));
    expect(withValue.metrics.overlapArea).toBeGreaterThan(0);
  });
});

function plan2(region: Region, s: EditorState, sheet: typeof SHEET) {
  return buildPlan(region, toPlanInput(s, { ...base, sheet }));
}

describe("planBaseFromForm", () => {
  it("ignores bad optional numbers and invalid sources instead of throwing", () => {
    const f = { ...defaultForm({ W: 6000, H: 1500 }), minStagger: "abc", maxSeam: "-3", minSegment: "50", sources: [{ id: 1, length: "x", width: "" }, { id: 2, length: "8000", width: "2000" }] };
    const b = planBaseFromForm(f, { mg: 5, ro: 2 }, ["C1"]);
    expect(b.constraints).toEqual({ minSegmentMm: 50 });
    expect(b.sheet.sheets).toEqual([{ W: 8000, H: 2000 }]);
    expect(b.confirmedHoleCuts).toEqual(["C1"]);
  });
});

describe("screenToWorld", () => {
  const box = "-10 -110 120 120"; // world x −10…110, y −10…110 (flipped)
  it("maps pointer positions to world coordinates (square element)", () => {
    const rect = { left: 100, top: 50, width: 240, height: 240 }; // scale 2
    expect(screenToWorld(rect, box, 100, 50)).toEqual({ x: -10, y: 110 }); // top-left of the box = (xmin, ymax)
    expect(screenToWorld(rect, box, 340, 290)).toEqual({ x: 110, y: -10 });
    const c = screenToWorld(rect, box, 220, 170);
    expect(c.x).toBeCloseTo(50, 9);
    expect(c.y).toBeCloseTo(50, 9);
  });

  it("accounts for letter-boxing in a wide element", () => {
    const rect = { left: 0, top: 0, width: 600, height: 240 }; // scale 2, 360 px of side margin
    const c = screenToWorld(rect, box, 300, 120); // element centre → box centre
    expect(c.x).toBeCloseTo(50, 9);
    expect(c.y).toBeCloseTo(50, 9);
    expect(screenToWorld(rect, box, 180, 0).x).toBeCloseTo(-10, 9); // left edge of the drawing
  });

  it("round-trips with svgViewBox for a real region", () => {
    const r = regionFromPolygon(rect(0, 0, 200, 100));
    const { box: vb } = svgViewBox(r);
    const [vx, vy, vw, vh] = vb.split(" ").map(Number);
    const el = { left: 10, top: 20, width: 700, height: 340 };
    const s = Math.min(el.width / vw, el.height / vh);
    const px = el.left + (el.width - vw * s) / 2 + (50 - vx) * s;
    const py = el.top + (el.height - vh * s) / 2 + (-30 - vy) * s; // world (50, 30) → flipped y = −30
    const w = screenToWorld(el, vb, px, py);
    expect(w.x).toBeCloseTo(50, 6);
    expect(w.y).toBeCloseTo(30, 6);
  });
});
