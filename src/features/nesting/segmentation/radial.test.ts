import { describe, expect, it } from "vitest";
import { circleLoop, normalizeRegion, regionArea, regionFromPolygon } from "./geometry";
import { buildPlan, type PlanInput, type Plan } from "./planner";
import { splitRegionsRadial } from "./free-cut";
import { rotateRadial, setRayAngle, resetRay, rayAngles, boundsFor, commit, newEditor, removeCut, setRadial, moveRadialCenter, stateFromInput, toPlanInput, undo, isRadial, RADIAL_ID } from "./editor";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanPreview, SegmentationPanel } from "./segment-dialog";
import { groupToRegion } from "./group-region";
import { commitSegmentation, savedPlan } from "./commit";
import { reportData } from "./report";
import type { Group } from "../nest-boost/engine";
import type { Region } from "./types";

const OFF = { enabled: false, mm: 0, side: "A" as const };
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2, gp: 5, cell: 5 };
const input = (over: Partial<PlanInput> = {}): PlanInput => ({ direction: "H", stripCuts: [], seamCuts: [], overlap: OFF, sheet: SHEET, holePolicy: "reject", ...over });
const err = (p: Plan) => p.issues.filter((i) => i.severity === "error").map((i) => i.code);
const total = (p: Plan) => p.segments.reduce((s, g) => s + g.finishedArea, 0);
const DISC: Region = normalizeRegion({ outer: circleLoop(0, 0, 1400), holes: [] });
const RING: Region = normalizeRegion({ outer: circleLoop(0, 0, 1400), holes: [circleLoop(0, 0, 500, false)] });
const PLATE = regionFromPolygon([[0, 0], [3000, 0], [3000, 1400], [0, 1400]]);

describe("radial cut", () => {
  it("splits a ring into N equal sectors around a centre in the hole, with no hole error", () => {
    const p = buildPlan(RING, input({ radial: { center: [0, 0], count: 6, startDeg: 0 } }));
    expect(err(p)).toEqual([]);
    expect(p.segments).toHaveLength(6);
    expect(p.segments.map((s) => s.id)).toEqual(["S01", "S02", "S03", "S04", "S05", "S06"]);
    const exp = Math.PI * (1400 ** 2 - 500 ** 2) / 6;
    for (const s of p.segments) expect(Math.abs(s.finishedArea - exp)).toBeLessThan(5); // a ray through the circle's own vertex is shifted by 0.0001 mm
    expect(total(p)).toBeCloseTo(Math.PI * (1400 ** 2 - 500 ** 2), 4);
    expect(p.segments.every((s) => s.finished.outer.some((e) => e.arc))).toBe(true);
    expect(p.valid).toBe(true);
    expect(p.metrics.cuts).toBe(6);
    // each sector touches its two neighbours: 6 seams, each ≈ the ring width 900
    const seams = p.seams.filter((m) => m.kind === "free");
    expect(seams).toHaveLength(6);
    for (const m of seams) expect(m.length).toBeCloseTo(900, 3);
    expect(new Set(seams.map((m) => m.cutId)).size).toBe(6);
  });

  it("splits a solid disc into pie slices meeting at the centre", () => {
    const p = buildPlan(DISC, input({ radial: { center: [0, 0], count: 5, startDeg: 90 } }));
    expect(p.segments).toHaveLength(5);
    for (const s of p.segments) expect(s.finishedArea).toBeCloseTo((Math.PI * 1400 ** 2) / 5, 3);
    expect(p.seams.filter((m) => m.kind === "free")).toHaveLength(5);
    for (const m of p.seams) expect(m.length).toBeCloseTo(1400, 3);
  });

  it("two divisions = one straight cut through the centre", () => {
    const p = buildPlan(DISC, input({ radial: { center: [0, 0], count: 2, startDeg: 0 } }));
    expect(p.segments).toHaveLength(2);
    expect(p.seams.reduce((s, m) => s + m.length, 0)).toBeCloseTo(2800, 3);
  });

  it("an off-centre point on a plate gives unequal pieces that still add up", () => {
    const p = buildPlan(PLATE, input({ radial: { center: [900, 400], count: 4, startDeg: 30 } }));
    expect(p.segments).toHaveLength(4);
    expect(total(p)).toBeCloseTo(3000 * 1400, 4);
  });

  it("a centre outside the part still cuts it, a centre far away that misses everything says so", () => {
    const outside = buildPlan(PLATE, input({ radial: { center: [-500, 700], count: 3, startDeg: 0 } }));
    expect(total(outside)).toBeCloseTo(3000 * 1400, 4);
    const miss = buildPlan(PLATE, input({ radial: { center: [-5000, -5000], count: 4, startDeg: 200 } }));
    expect(err(miss)).toContain("CUT_OUTSIDE_PART");
  });

  it("a ray that cuts through a hole other than the centre's is a hole cut", () => {
    const plate = normalizeRegion({ outer: PLATE.outer, holes: [regionFromPolygon([[2000, 600], [2400, 600], [2400, 900], [2000, 900]]).outer] });
    const p = buildPlan(plate, input({ radial: { center: [500, 750], count: 2, startDeg: 0 } }));
    expect(err(p)).toContain("HOLE_CUT");
  });

  it("works together with a strip cut, and with a free cut", () => {
    const p = buildPlan(PLATE, input({ stripCuts: [{ id: "C1", pos: 700 }], radial: { center: [1500, 700], count: 4, startDeg: 45 } }));
    expect(total(p)).toBeCloseTo(3000 * 1400, 4);
    expect(p.segments.length).toBeGreaterThanOrEqual(5);
    const q = buildPlan(PLATE, input({ radial: { center: [1500, 700], count: 4, startDeg: 45 }, freeCuts: [{ id: "F1", pts: [[100, -50], [200, 1500]] }] }));
    expect(total(q)).toBeCloseTo(3000 * 1400, 4);
  });

  it("rejects bad settings and an overlap together with it", () => {
    for (const bad of [{ center: [0, 0], count: 1, startDeg: 0 }, { center: [0, 0], count: 2.5, startDeg: 0 }, { center: [NaN, 0], count: 4, startDeg: 0 }, { center: [0, 0], count: 100, startDeg: 0 }]) {
      expect(err(buildPlan(DISC, input({ radial: bad as never })))).toContain("BAD_CUT");
    }
    expect(err(buildPlan(DISC, input({ radial: { center: [0, 0], count: 4, startDeg: 0 }, overlap: { enabled: true, mm: 20, side: "A" } })))).toContain("FREE_CUT_OVERLAP");
  });

  it("a centre on a vertex of the part is moved by a tiny step and the pieces still add up", () => {
    const p = buildPlan(PLATE, input({ radial: { center: [0, 0], count: 3, startDeg: 0 } }));
    expect(total(p)).toBeCloseTo(3000 * 1400, 3);
  });

  it("the kernel keeps the pieces in sector order", () => {
    const r = splitRegionsRadial([RING], { center: [0, 0], count: 4, startDeg: 0 }, 5000);
    expect(r.parts[0].sectors).toEqual([0, 1, 2, 3]);
    expect(Math.abs(regionArea(r.parts[0].pieces[0]) - Math.PI * (1400 ** 2 - 500 ** 2) / 4)).toBeLessThan(5);
  });
});

describe("radial cut: editor", () => {
  const st = () => stateFromInput(input());
  const ok = (r: { ok: boolean }) => { if (!r.ok) throw new Error((r as unknown as { reason: string }).reason); return (r as unknown as { state: ReturnType<typeof st> }).state; };

  it("creates the cut with 4 divisions, changes values, validates them, removes it, undoes", () => {
    let ed = newEditor(st());
    ed = commit(ed, ok(setRadial(ed.present, { center: [10, 20] })));
    expect(ed.present.radial).toEqual({ center: [10, 20], count: 4, startDeg: 0 });
    expect(isRadial(ed.present, RADIAL_ID)).toBe(true);
    ed = commit(ed, ok(setRadial(ed.present, { count: 8, startDeg: 22.5 })));
    expect(ed.present.radial).toEqual({ center: [10, 20], count: 8, startDeg: 22.5 });
    expect(setRadial(ed.present, { count: 1 }).ok).toBe(false);
    expect(setRadial(ed.present, { count: 3.5 }).ok).toBe(false);
    expect(setRadial(ed.present, { count: 99 }).ok).toBe(false);
    expect(setRadial(ed.present, { center: [NaN, 0] }).ok).toBe(false);
    expect(setRadial(ed.present, { count: 8 })).toEqual({ ok: true, state: ed.present }); // no change, same object
    expect(ok(moveRadialCenter(ed.present, [103, 48], 50)).radial!.center).toEqual([100, 50]);
    ed = commit(ed, ok(removeCut(ed.present, RADIAL_ID)));
    expect(ed.present.radial).toBeNull();
    ed = undo(ed);
    expect(ed.present.radial?.count).toBe(8);
  });

  it("round-trips through the plan input and leaves the key out when there is none", () => {
    const s = ok(setRadial(st(), { center: [5, 6], count: 3, startDeg: 10 }));
    const { direction: _d, stripCuts: _s, seamCuts: _m, freeCuts: _f, radial: _r, ...rest } = input();
    void _d; void _s; void _m; void _f; void _r;
    expect(toPlanInput(s, rest).radial).toEqual({ center: [5, 6], count: 3, startDeg: 10 });
    expect(stateFromInput(toPlanInput(s, rest)).radial).toEqual(s.radial);
    expect("radial" in toPlanInput(st(), rest)).toBe(false);
  });
});

describe("radial cut: dialog, approve, report", () => {
  const g: Group = { id: 1, sn: 1, name: "PLATE-001", qty: 2, th: 10, material: "S235", outer: [[0, 0], [3000, 0], [3000, 1400], [0, 1400]], holes: [], w: 3000, h: 1400, area: 3000 * 1400, per: 8800 };
  const region = groupToRegion(g).region;
  const plan = buildPlan(region, input({ radial: { center: [1500, 700], count: 4, startDeg: 45 } }));
  const noop = () => undefined;

  it("shows the centre dot, the rays and the number fields", () => {
    const state = stateFromInput(plan.input);
    const html = renderToStaticMarkup(createElement(PlanPreview, { region, plan, edit: { state, bounds: boundsFor([0, 0, 3000, 1400], "H"), selected: RADIAL_ID, mode: null, onSelect: noop, onDrag: noop, onDragEnd: noop, onAdd: noop, onAddFree: noop, onMoveFreePoint: noop, onMoveFree: noop, onSplitFree: noop, onRemoveFreePoint: noop, onSetCenter: noop, onRotateRadial: noop } }));
    expect(html).toContain('data-center="R"');
    expect((html.match(/pointer-events="none"/g) ?? []).length).toBeGreaterThan(4);
    const panel = renderToStaticMarkup(createElement(SegmentationPanel, { group: g, nest: { W: 6000, H: 1500, mg: 5, ro: 2, gp: 5, cell: 5 }, existing: plan.input }));
    expect(panel).toContain("Radial");
    expect(panel).toContain('aria-label="Divisions"');
    expect(panel).toContain('aria-label="Centre X (mm)"');
  });

  it("approves into one piece per sector, saves the settings and reports them", () => {
    expect(plan.valid).toBe(true);
    const r = commitSegmentation({ groups: [g], parentId: 1, plan, counters: { id: 100, sn: 10 } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.children.map((c) => c.name)).toEqual(["PLATE-001-S01", "PLATE-001-S02", "PLATE-001-S03", "PLATE-001-S04"]);
    expect(savedPlan(JSON.parse(JSON.stringify(r.parent)))?.radial).toEqual({ center: [1500, 700], count: 4, startDeg: 45 });
    const d = reportData({ parent: g, original: region, plan, generatedAt: "t" });
    expect(String(d.summary.find(([k]) => k === "Radial cut")?.[1])).toContain("4 sectors");
    expect(Math.abs(d.reassemblyDiffMm2)).toBeLessThan(0.01);
  });
});

describe("radial cut: turning the pattern by dragging a ray", () => {
  const base = () => {
    const r = setRadial(stateFromInput(input()), { center: [0, 0], count: 12, startDeg: 22.5 });
    if (!r.ok) throw new Error("x");
    return r.state;
  };
  const start = (r: ReturnType<typeof rotateRadial>) => (r.ok ? r.state.radial!.startDeg : NaN);

  it("dragging ray 0 turns the first cut there and every other ray follows", () => {
    expect(start(rotateRadial(base(), 0, 47.3))).toBeCloseTo(47.3, 6);
    // ray 3 of 12 (step 30°) dragged to 100° → start angle 10°
    expect(start(rotateRadial(base(), 3, 100))).toBeCloseTo(10, 6);
  });

  it("pulls a ray onto horizontal / vertical when it is within 2°, not when it is further", () => {
    expect(start(rotateRadial(base(), 0, 1.4))).toBe(0); // horizontal
    expect(start(rotateRadial(base(), 3, 91.9))).toBe(0); // ray 3 vertical → pattern at 0° (rays at 0, 30, 60, 90 …)
    expect(start(rotateRadial(base(), 0, 3))).toBeCloseTo(3, 6);
  });

  it("Shift moves in 5° steps; the angle stays in 0…360", () => {
    expect(start(rotateRadial(base(), 0, 47.3, true))).toBe(45);
    expect(start(rotateRadial(base(), 0, -30))).toBe(330);
    expect(start(rotateRadial(base(), 5, 10))).toBe(220); // 10° − 5·30° = −140° → 220°
  });

  it("the plan follows: after turning, one cut line is exactly horizontal", () => {
    const plate = regionFromPolygon([[-2000, -1000], [2000, -1000], [2000, 1000], [-2000, 1000]]);
    const r = rotateRadial(base(), 0, 0.5);
    if (!r.ok) throw new Error("x");
    const { direction: _d, stripCuts: _s, seamCuts: _m, freeCuts: _f, radial: _r, ...rest } = input();
    void _d; void _s; void _m; void _f; void _r;
    const p = buildPlan(plate, toPlanInput(r.state, rest));
    const horizontal = p.seams.filter((m) => m.path!.every(([a, b]) => Math.abs(a[1]) < 1e-3 && Math.abs(b[1]) < 1e-3));
    expect(horizontal.length).toBeGreaterThan(0);
  });

  it("refuses without a radial cut or with a bad ray", () => {
    expect(rotateRadial(stateFromInput(input()), 0, 10).ok).toBe(false);
    expect(rotateRadial(base(), 12, 10).ok).toBe(false);
    expect(rotateRadial(base(), 0, NaN).ok).toBe(false);
  });
});

describe("radial cut: one ray on its own", () => {
  const mk = (count = 12, startDeg = 22.5) => {
    const r = setRadial(stateFromInput(input()), { center: [0, 0], count, startDeg });
    if (!r.ok) throw new Error("x");
    return r.state;
  };
  const okState = (r: ReturnType<typeof setRayAngle>) => {
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  };

  it("moves only that ray; the others stay on the pattern", () => {
    const s = okState(setRayAngle(mk(), 2, 70)); // pattern angle of R3 is 82.5°
    const a = rayAngles(s);
    expect(a[2]).toBe(70);
    expect(a.filter((_, i) => i !== 2)).toEqual(rayAngles(mk()).filter((_, i) => i !== 2));
    expect(s.radial!.custom![2]).toBe(70);
    expect(s.radial!.custom!.filter((c) => c != null)).toHaveLength(1);
  });

  it("snaps to horizontal / vertical and takes typed values exactly", () => {
    // R6 sits at 172.5° with R5 at 142.5° and R7 at 202.5° on either side
    expect(rayAngles(okState(setRayAngle(mk(), 5, 180.9)))[5]).toBe(180);
    expect(rayAngles(okState(setRayAngle(mk(), 5, 190.37)))[5]).toBeCloseTo(190.37, 4);
    expect(rayAngles(okState(setRayAngle(mk(), 5, 187.3, true)))[5]).toBe(185);
  });

  it("is held between its neighbours and says so", () => {
    const base = mk(); // rays at 22.5, 52.5, 82.5 …
    const r = setRayAngle(base, 1, 100); // past R3 (82.5°)
    if (!r.ok) throw new Error(r.reason);
    expect(rayAngles(r.state)[1]).toBeCloseTo(82.5 - 0.5, 6);
    expect(r.note).toMatch(/R2/);
    const low = setRayAngle(base, 1, 10);
    if (!low.ok) throw new Error(low.reason);
    expect(rayAngles(low.state)[1]).toBeCloseTo(22.5 + 0.5, 6);
  });

  it("two rays: the second can be anywhere except on top of the first", () => {
    const s = mk(2, 0);
    expect(rayAngles(okState(setRayAngle(s, 1, 120)))).toEqual([0, 120]);
    const near = rayAngles(okState(setRayAngle(s, 1, 359.9)))[1]; // snaps onto ray 1, so it is held 0.5° away from it
    expect(Math.min(near, 360 - near)).toBeCloseTo(0.5, 6);
    expect(rayAngles(okState(setRayAngle(s, 1, 350)))[1]).toBe(350);
  });

  it("back to pattern; changing the number of divisions starts again; turning the pattern turns the hand-set rays too", () => {
    let s = okState(setRayAngle(mk(), 2, 70));
    expect(rayAngles(okState(resetRay(s, 2)))).toEqual(rayAngles(mk()));
    expect(okState(resetRay(s, 2)).radial!.custom).toBeUndefined();
    const more = okState(setRadial(s, { count: 8 }));
    expect(more.radial!.custom).toBeUndefined();
    const turned = okState(rotateRadial(s, 0, 32.5)); // ray 0 from 22.5° to 32.5° = +10°
    expect(rayAngles(turned)[2]).toBeCloseTo(80, 6);
    expect(rayAngles(turned)[0]).toBeCloseTo(32.5, 6);
    // no change → same object
    expect(resetRay(mk(), 3)).toEqual({ ok: true, state: mk() });
  });

  it("refuses rays that cross, bad values and a missing radial cut", () => {
    expect(setRayAngle(stateFromInput(input()), 0, 10).ok).toBe(false);
    expect(setRayAngle(mk(), 99, 10).ok).toBe(false);
    expect(setRayAngle(mk(), 0, NaN).ok).toBe(false);
    expect(setRadial(mk(), { custom: [null, 200] }).ok).toBe(false); // R2 at 200° jumps past R3
  });

  it("the plan cuts along the hand-set ray: unequal sectors, still adding up, one seam exactly horizontal", () => {
    const plate = regionFromPolygon([[-2000, -1000], [2000, -1000], [2000, 1000], [-2000, 1000]]);
    const s = okState(setRayAngle(mk(4, 45), 0, 0)); // R1 horizontal on its own; R2..R4 at 135, 225, 315
    const { direction: _d, stripCuts: _s, seamCuts: _m, freeCuts: _f, radial: _r, ...rest } = input();
    void _d; void _s; void _m; void _f; void _r;
    const p = buildPlan(plate, toPlanInput(s, rest));
    expect(p.segments).toHaveLength(4);
    expect(total(p)).toBeCloseTo(4000 * 2000, 4);
    const areas = p.segments.map((x) => Math.round(x.finishedArea));
    expect(new Set(areas).size).toBeGreaterThan(1);
    expect(p.seams.some((m) => m.cutId === "R1" && m.path!.every(([a, b]) => Math.abs(a[1]) < 1e-3 && Math.abs(b[1]) < 1e-3))).toBe(true);
    // JSON round trip keeps the hand-set ray
    const back = buildPlan(plate, JSON.parse(JSON.stringify(p.input)));
    expect(back.segments.map((x) => Math.round(x.finishedArea))).toEqual(areas);
  });

  it("the dialog draws a handle and a label for every ray and offers the angle field for the picked one", () => {
    const g: Group = { id: 1, sn: 1, name: "P", qty: 1, th: 10, material: "S", outer: [[0, 0], [3000, 0], [3000, 1400], [0, 1400]], holes: [], w: 3000, h: 1400, area: 3000 * 1400, per: 8800 };
    const region = groupToRegion(g).region;
    const s = okState(setRayAngle(okState(setRadial(stateFromInput(input()), { center: [1500, 700], count: 4, startDeg: 45 })), 1, 100));
    const plan = buildPlan(region, toPlanInput(s, (({ direction, stripCuts, seamCuts, ...r }) => (void direction, void stripCuts, void seamCuts, r))(input())));
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(PlanPreview, { region, plan, edit: { state: s, bounds: boundsFor([0, 0, 3000, 1400], "H"), selected: RADIAL_ID, mode: null, onSelect: noop, onDrag: noop, onDragEnd: noop, onAdd: noop, onAddFree: noop, onMoveFreePoint: noop, onMoveFree: noop, onSplitFree: noop, onRemoveFreePoint: noop, onSetCenter: noop, onRotateRadial: noop, selectedRay: 1, onSelectRay: noop, onSetRayAngle: noop } }));
    for (let i = 0; i < 4; i++) expect(html).toContain(`data-ray="${i}"`);
    for (let i = 1; i <= 4; i++) expect(html).toContain(`>R${i}<`);
    expect(html).toContain("cursor:move"); // the picked ray
  });
});
