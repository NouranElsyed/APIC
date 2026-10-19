import { describe, expect, it } from "vitest";
import { regionToGroupShape } from "./convert";
import { circleLoop, flattenLoop, regionBBox, regionContains, regionFromPolygon, regionRings, ringsContain, ringsDistance } from "./geometry";
import { buildPlan, generateCandidates, type GenSettings, type OverlapSpec, type PlanInput, type Plan } from "./planner";
import type { Pt, Region } from "./types";

/* ---------------- helpers ---------------- */

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rectRegion = (x0: number, y0: number, x1: number, y1: number, holes: Pt[][] = []) => regionFromPolygon(rect(x0, y0, x1, y1), holes);
const circleRegion = (cx: number, cy: number, r: number): Region => ({ outer: circleLoop(cx, cy, r), holes: [] });

const OFF: OverlapSpec = { enabled: false, mm: 0, side: "A" };
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 };
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  direction: "H",
  stripCuts: [],
  seamCuts: [],
  overlap: OFF,
  sheet: SHEET,
  holePolicy: "reject",
  ...over,
});
const gen = (over: Partial<GenSettings> = {}): GenSettings => ({
  directions: ["H"],
  sheet: SHEET,
  overlap: OFF,
  holePolicy: "reject",
  ...over,
});
const codes = (p: Plan) => p.issues.map((i) => i.code);
const err = (p: Plan) => p.issues.filter((i) => i.severity === "error").map((i) => i.code);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Every sample point must lie in exactly one finished segment if it is in the part, in none otherwise. */
function expectFinishedPartition(original: Region, plan: Plan, n = 4000) {
  const rnd = mulberry32(11);
  const [x0, y0, x1, y1] = regionBBox(original);
  const orig = regionRings(original);
  const segs = plan.segments.map((s) => regionRings(s.finished));
  let checked = 0;
  for (let i = 0; i < n; i++) {
    const p: Pt = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
    if (Math.min(ringsDistance(orig, p), ...segs.map((r) => ringsDistance(r, p))) < 0.05) continue;
    checked++;
    const got = segs.filter((r) => ringsContain(r, p)).length;
    if (got !== (ringsContain(orig, p) ? 1 : 0)) throw new Error(`partition mismatch at ${p}: got ${got}`);
  }
  expect(checked).toBeGreaterThan(n * 0.4);
}

/* ---------------- converter ---------------- */

describe("regionToGroupShape", () => {
  it("moves the outline to the origin and follows the engine conventions", () => {
    const sh = regionToGroupShape(rectRegion(100, 200, 160, 230, [rect(110, 210, 120, 220)]));
    expect(sh.origin).toEqual([100, 200]);
    expect([sh.w, sh.h]).toEqual([60, 30]);
    expect(sh.area).toBeCloseTo(1800 - 100, 9); // outer − holes
    expect(sh.per).toBeCloseTo(180 + 40, 9); // outer + holes
    expect(Math.min(...sh.outer.map((p) => p[0]))).toBe(0);
  });

  it("gives the exact bounding box for circles (arc extremes included)", () => {
    const sh = regionToGroupShape(circleRegion(50, 50, 100), 0.1);
    expect(sh.w).toBeCloseTo(200, 9);
    expect(sh.h).toBeCloseTo(200, 9);
    expect(sh.exactArea).toBeCloseTo(Math.PI * 1e4, 6);
    expect(Math.abs(sh.area - sh.exactArea)).toBeLessThan(0.1 * sh.per); // within tolerance × perimeter
  });

  it("flattenLoop with extremes adds the quadrant points", () => {
    const pts = flattenLoop(circleLoop(0, 0, 100), 5, { extremes: true });
    for (const p of [[100, 0], [0, 100], [-100, 0], [0, -100]]) {
      expect(pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)).toBe(true);
    }
  });
});

/* ---------------- buildPlan: structure ---------------- */

describe("buildPlan — cells, naming, seams", () => {
  it("one transverse seam gives two numbered segments and one seam", () => {
    const region = rectRegion(0, 0, 100, 50);
    const plan = buildPlan(region, input({ seamCuts: [{ id: "T1.1", strip: 0, pos: 40 }], sheet: { sheets: [{ W: 200, H: 100 }], mg: 0, ro: 2 } }));
    expect(plan.valid).toBe(true);
    expect(plan.segments.map((s) => s.id)).toEqual(["S01", "S02"]);
    expect(plan.seams).toHaveLength(1);
    expect(plan.seams[0].length).toBeCloseTo(50, 9);
    expect(plan.seams[0].kind).toBe("transverse");
    expect(plan.metrics.finishedArea).toBeCloseTo(5000, 9);
    expect(plan.metrics.cutLength).toBeCloseTo(50, 9);
    expect(plan.metrics.overlapArea).toBeCloseTo(0, 9);
  });

  it("strip cuts number segments strip by strip", () => {
    const region = rectRegion(0, 0, 100, 90);
    const plan = buildPlan(region, input({
      stripCuts: [{ id: "C1", pos: 30 }, { id: "C2", pos: 60 }],
      seamCuts: [{ id: "T2.1", strip: 1, pos: 50 }],
      sheet: { sheets: [{ W: 500, H: 500 }], mg: 0, ro: 2 },
    }));
    expect(plan.segments.map((s) => `${s.id}:${s.cell.strip}.${s.cell.index}`)).toEqual(["S01:0.0", "S02:1.0", "S03:1.1", "S04:2.0"]);
    // C1: S01|S02 and S01|S03; C2: S02|S04 and S03|S04
    expect(plan.seams.filter((s) => s.kind === "strip").map((s) => s.id)).toEqual(["C1:S01|S02", "C1:S01|S03", "C2:S02|S04", "C2:S03|S04"]);
    expect(plan.metrics.finishedArea).toBeCloseTo(9000, 9);
    expectFinishedPartition(region, plan);
  });

  it("disconnected pieces of one cell get letters", () => {
    const u: Pt[] = [[0, 0], [30, 0], [30, 40], [20, 40], [20, 10], [10, 10], [10, 40], [0, 40]];
    const region = regionFromPolygon(u);
    const plan = buildPlan(region, input({ stripCuts: [{ id: "C1", pos: 25 }], sheet: { sheets: [{ W: 500, H: 500 }], mg: 0, ro: 2 } }));
    expect(plan.segments.map((s) => s.id)).toEqual(["S01", "S02a", "S02b"]);
    expect(plan.metrics.finishedArea).toBeCloseTo(900, 9);
    expectFinishedPartition(region, plan);
  });

  it("works in the vertical direction", () => {
    const region = rectRegion(0, 0, 100, 50);
    const plan = buildPlan(region, input({ direction: "V", stripCuts: [{ id: "C1", pos: 70 }], sheet: { sheets: [{ W: 500, H: 500 }], mg: 0, ro: 2 } }));
    expect(plan.segments.map((s) => s.finishedArea)).toEqual([3500, 1500]);
    expect(plan.seams[0].axis).toBe("x");
    expect(plan.seams[0].length).toBeCloseTo(50, 9);
  });

  it("keeps circle arcs in every segment and conserves area", () => {
    const region = circleRegion(0, 0, 500);
    const plan = buildPlan(region, input({ stripCuts: [{ id: "C1", pos: -200 }, { id: "C2", pos: 200 }], sheet: { sheets: [{ W: 2000, H: 2000 }], mg: 0, ro: 2 } }));
    expect(plan.valid).toBe(true);
    expect(plan.metrics.finishedArea).toBeCloseTo(Math.PI * 500 * 500, 4);
    for (const s of plan.segments) expect(s.finished.outer.some((e) => e.arc && e.arc.r === 500)).toBe(true);
    expectFinishedPartition(region, plan);
  });
});

/* ---------------- buildPlan: overlap ---------------- */

describe("buildPlan — overlap", () => {
  const region = rectRegion(0, 0, 100, 50);
  const big = { sheets: [{ W: 500, H: 500 }], mg: 0, ro: 2 };
  const seam = [{ id: "T1.1", strip: 0, pos: 60 }];

  it("off (default): cut geometry is the finished geometry", () => {
    const plan = buildPlan(region, input({ seamCuts: seam, sheet: big }));
    for (const s of plan.segments) expect(s.cut).toBe(s.finished);
    expect(plan.metrics.overlapArea).toBe(0);
    expect(plan.seams[0].carrier).toBeNull();
  });

  it('policy "A": the low side extends into the high side', () => {
    const plan = buildPlan(region, input({ seamCuts: seam, sheet: big, overlap: { enabled: true, mm: 10, side: "A" } }));
    expect(plan.segments.map((s) => s.finishedArea)).toEqual([3000, 2000]);
    expect(plan.segments.map((s) => s.cutArea)).toEqual([3500, 2000]);
    expect(plan.metrics.overlapArea).toBeCloseTo(500, 9);
    expect(plan.seams[0].carrier).toBe("low");
    expect(plan.seams[0].length).toBeCloseTo(50, 9); // seam length ignores the overlap
    expect(plan.metrics.finishedArea).toBeCloseTo(5000, 9); // takeoff area ignores the overlap
  });

  it('policy "symmetric": each side extends half', () => {
    const plan = buildPlan(region, input({ seamCuts: seam, sheet: big, overlap: { enabled: true, mm: 10, side: "symmetric" } }));
    expect(plan.segments.map((s) => s.cutArea)).toEqual([3250, 2250]);
    expect(plan.seams[0].carrier).toBe("both");
  });

  it('policy "alternate": carriers alternate by cut index', () => {
    const plan = buildPlan(region, input({
      seamCuts: [{ id: "T1.1", strip: 0, pos: 30 }, { id: "T1.2", strip: 0, pos: 70 }],
      sheet: big,
      overlap: { enabled: true, mm: 10, side: "alternate" },
    }));
    expect(plan.seams.map((s) => s.carrier)).toEqual(["low", "high"]);
    // cut T1.1 is carried by its low side (cell 0 grows to 0–40); cut T1.2 by its high side (cell 2 grows to 60–100);
    // the middle cell sits between the two non-carrying sides, so it keeps 30–70.
    expect(plan.segments.map((s) => s.finishedArea)).toEqual([1500, 2000, 1500]);
    expect(plan.segments.map((s) => s.cutArea)).toEqual([2000, 2000, 2000]);
    expect(plan.metrics.overlapArea).toBeCloseTo(1000, 9);
    expect(regionBBox(plan.segments[0].cut)).toEqual([0, 0, 40, 50]);
    expect(regionBBox(plan.segments[1].cut)).toEqual([30, 0, 70, 50]);
    expect(regionBBox(plan.segments[2].cut)).toEqual([60, 0, 100, 50]);
  });

  it("works across strips and never leaves the original outline", () => {
    const disk = circleRegion(0, 0, 500);
    const plan = buildPlan(disk, input({
      stripCuts: [{ id: "C1", pos: -100 }, { id: "C2", pos: 150 }],
      overlap: { enabled: true, mm: 40, side: "A" },
      sheet: { sheets: [{ W: 3000, H: 3000 }], mg: 0, ro: 2 },
    }));
    expect(plan.valid).toBe(true);
    expect(plan.metrics.overlapArea).toBeGreaterThan(0);
    const rnd = mulberry32(3);
    for (const s of plan.segments) {
      const cutRings = regionRings(s.cut);
      const finRings = regionRings(s.finished);
      const [x0, y0, x1, y1] = regionBBox(s.cut);
      for (let i = 0; i < 800; i++) {
        const p: Pt = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
        if (ringsDistance(cutRings, p) < 0.05) continue;
        if (ringsContain(finRings, p)) expect(ringsContain(cutRings, p)).toBe(true); // finished ⊆ cut
        if (ringsContain(cutRings, p)) expect(regionContains(disk, p)).toBe(true); // cut ⊆ original
      }
    }
    // the lowest strip carries the overlap upward only: its cut is larger, the top strip's is not
    expect(plan.segments[0].cutArea).toBeGreaterThan(plan.segments[0].finishedArea);
    expect(plan.segments[2].cutArea).toBeCloseTo(plan.segments[2].finishedArea, 6);
  });

  it("is rejected when enabled without a value", () => {
    const plan = buildPlan(region, input({ seamCuts: seam, overlap: { enabled: true, mm: 0, side: "A" } }));
    expect(plan.valid).toBe(false);
    expect(codes(plan)).toContain("INVALID_OVERLAP");
    expect(plan.segments).toHaveLength(0);
  });

  it("overlap can make a segment stop fitting", () => {
    const sheet = { sheets: [{ W: 1000, H: 1000 }], mg: 0, ro: 2 };
    const r = rectRegion(0, 0, 1900, 500);
    const ok = buildPlan(r, input({ seamCuts: [{ id: "T1.1", strip: 0, pos: 950 }], sheet }));
    expect(ok.valid).toBe(true);
    const tooMuch = buildPlan(r, input({ seamCuts: [{ id: "T1.1", strip: 0, pos: 950 }], sheet, overlap: { enabled: true, mm: 100, side: "A" } }));
    expect(err(tooMuch)).toContain("SEGMENT_TOO_LARGE");
  });
});

/* ---------------- buildPlan: validation ---------------- */

describe("buildPlan — validation", () => {
  const sheet = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 };

  it("flags a segment that does not fit, and marks solo segments as info", () => {
    const tooBig = buildPlan(rectRegion(0, 0, 7000, 1000), input({ sheet }));
    expect(err(tooBig)).toEqual(["SEGMENT_TOO_LARGE"]);
    expect(tooBig.valid).toBe(false);
    const solo = buildPlan(rectRegion(0, 0, 5995, 1495), input({ sheet }));
    expect(solo.valid).toBe(true);
    expect(codes(solo)).toContain("SEGMENT_SOLO");
    expect(solo.metrics.soloSegments).toBe(1);
  });

  it("flags cuts that do not cross the part and bad positions", () => {
    const r = rectRegion(0, 0, 100, 50);
    const outside = buildPlan(r, input({ stripCuts: [{ id: "C1", pos: 500 }], sheet: { sheets: [{ W: 500, H: 500 }], mg: 0, ro: 2 } }));
    expect(codes(outside)).toContain("CUT_OUTSIDE_PART");
    expect(buildPlan(r, input({ stripCuts: [{ id: "C1", pos: 20 }, { id: "C2", pos: 20 }] })).valid).toBe(false);
    expect(codes(buildPlan(r, input({ seamCuts: [{ id: "T9", strip: 3, pos: 10 }] })))).toContain("BAD_CUT");
  });

  describe("hole policy", () => {
    const withHole = rectRegion(0, 0, 100, 50, [rect(40, 20, 60, 30)]);
    const big = { sheets: [{ W: 500, H: 500 }], mg: 0, ro: 2 };
    const cut = [{ id: "T1.1", strip: 0, pos: 50 }];

    it("reject: a cut through a hole is an error", () => {
      const p = buildPlan(withHole, input({ seamCuts: cut, sheet: big, holePolicy: "reject" }));
      expect(err(p)).toEqual(["HOLE_CUT"]);
    });
    it("warn: needs confirmation, then passes with a warning", () => {
      const un = buildPlan(withHole, input({ seamCuts: cut, sheet: big, holePolicy: "warn" }));
      expect(err(un)).toEqual(["HOLE_CUT_UNCONFIRMED"]);
      const ok = buildPlan(withHole, input({ seamCuts: cut, sheet: big, holePolicy: "warn", confirmedHoleCuts: ["T1.1"] }));
      expect(ok.valid).toBe(true);
      expect(ok.issues.find((i) => i.code === "HOLE_CUT")?.severity).toBe("warning");
    });
    it("a cut beside the hole is fine", () => {
      expect(buildPlan(withHole, input({ seamCuts: [{ id: "T1.1", strip: 0, pos: 20 }], sheet: big })).valid).toBe(true);
    });
  });

  describe("seam constraints (all optional)", () => {
    const r = rectRegion(0, 0, 1000, 200);
    const big = { sheets: [{ W: 5000, H: 5000 }], mg: 0, ro: 2 };
    const two = (a: number, b: number) =>
      input({ stripCuts: [{ id: "C1", pos: 100 }], seamCuts: [{ id: "T1.1", strip: 0, pos: a }, { id: "T2.1", strip: 1, pos: b }], sheet: big });

    it("nothing is enforced unless set", () => {
      expect(buildPlan(r, two(500, 500)).valid).toBe(true);
    });
    it("forbids cross junctions", () => {
      const p = buildPlan(r, { ...two(500, 500), constraints: { forbidCrossJunctions: true } });
      expect(err(p)).toEqual(["CROSS_JUNCTION"]);
      expect(buildPlan(r, { ...two(500, 530), constraints: { forbidCrossJunctions: true } }).valid).toBe(true);
    });
    it("enforces a minimum stagger", () => {
      const c = { minSeamStagger: 100 };
      expect(err(buildPlan(r, { ...two(500, 550), constraints: c }))).toEqual(["SEAM_STAGGER"]);
      expect(buildPlan(r, { ...two(500, 650), constraints: c }).valid).toBe(true);
    });
    it("enforces a maximum seam length", () => {
      expect(err(buildPlan(r, { ...two(500, 650), constraints: { maxSeamLength: 90 } }))).toContain("SEAM_TOO_LONG");
    });
    it("enforces seam-to-boundary distance and minimum segment size", () => {
      expect(err(buildPlan(r, { ...two(30, 650), constraints: { minSeamToBoundary: 50 } }))).toContain("SEAM_NEAR_BOUNDARY");
      expect(err(buildPlan(r, { ...two(500, 650), constraints: { minSegmentMm: 150 } }))).toContain("SEGMENT_TOO_SMALL");
    });
  });
});

/* ---------------- generateCandidates ---------------- */

/** Smallest distance between any transverse seam of strip 0 and any of strip 1. */
const strip0Vs1Gap = (c: { plan: Plan }) => {
  const at = (strip: number) => c.plan.input.seamCuts.filter((s) => s.strip === strip).map((s) => s.pos);
  const a = at(0);
  const b = at(1);
  expect(a.length).toBeGreaterThan(0);
  expect(b.length).toBeGreaterThan(0);
  return Math.min(...a.flatMap((p) => b.map((q) => Math.abs(p - q))));
};

describe("generateCandidates", () => {
  it("long rectangle: seams only where the sheet is too short, all segments fit", () => {
    const region = rectRegion(0, 0, 12000, 1490);
    const cands = generateCandidates(region, gen({ allowSolo: false }));
    const best = cands[0];
    expect(best.plan.valid).toBe(true);
    expect(best.plan.metrics.segments).toBe(3); // ceil(12000 / 5990)
    expect(best.plan.input.stripCuts).toHaveLength(0);
    expect(best.plan.metrics.finishedArea).toBeCloseTo(12000 * 1490, 3);
    expectFinishedPartition(region, best.plan);
  });

  it("Ø7520 circle on 6000 × 1500: valid layouts of the same size as the manual drawing or better", () => {
    const circle = circleRegion(0, 0, 3760);
    const cands = generateCandidates(circle, gen({ directions: ["H", "V"] }));
    expect(cands.length).toBeGreaterThan(5);
    const valid = cands.filter((c) => c.plan.valid);
    expect(valid.length).toBeGreaterThan(0);
    const best = valid[0];
    expect(best.plan.metrics.segments).toBeLessThanOrEqual(10); // the hand layout in the drawing has 10 pieces
    expect(best.plan.metrics.finishedArea).toBeCloseTo(Math.PI * 3760 * 3760, 2);
    for (const s of best.plan.segments) expect(["READY", "READY_SOLO"]).toContain(s.fit.status);
    expect(cands.some((c) => c.direction === "V")).toBe(true);
    expectFinishedPartition(circle, best.plan, 5000);
    // listed valid-first, then by the sheet lower bound — solo (margin-free) layouts do not jump the queue
    const lbs = valid.map((c) => c.plan.metrics.sheetsLowerBound!);
    expect(lbs).toEqual([...lbs].sort((a, b) => a - b));
    expect(best.plan.metrics.soloSegments).toBe(0);
    expect(cands.slice(0, valid.length).every((c) => c.plan.valid)).toBe(true);
  });

  it("different first-cut offsets really change the layout", () => {
    const circle = circleRegion(0, 0, 3760);
    const cands = generateCandidates(circle, gen({ allowSolo: false }));
    const counts = new Set(cands.map((c) => c.plan.metrics.segments));
    expect(counts.size).toBeGreaterThan(1);
    expect(new Set(cands.map((c) => c.pattern)).size).toBeGreaterThan(2);
  });

  it("staggers seams between adjacent strips (and not when switched off)", () => {
    const region = rectRegion(0, 0, 12000, 2980); // two full strips, each needs one seam
    const on = generateCandidates(region, gen({ allowSolo: false, staggered: true })).find((c) => c.plan.input.stripCuts.length === 1 && c.plan.valid)!;
    expect(strip0Vs1Gap(on)).toBeGreaterThan(100);
    const off = generateCandidates(region, gen({ allowSolo: false, staggered: false })).find((c) => c.plan.input.stripCuts.length === 1 && c.plan.valid)!;
    expect(strip0Vs1Gap(off)).toBeLessThan(1e-6); // aligned seams
    expect(codes(off.plan)).not.toContain("CROSS_JUNCTION"); // allowed unless the constraint is set
  });

  it("honours a minimum stagger and a no-cross-junction rule when generating", () => {
    const region = rectRegion(0, 0, 12000, 2980);
    const c = generateCandidates(region, gen({ allowSolo: false, constraints: { minSeamStagger: 400, forbidCrossJunctions: true } }))
      .find((x) => x.plan.input.stripCuts.length === 1)!;
    expect(c.plan.valid).toBe(true);
    expect(strip0Vs1Gap(c)).toBeGreaterThanOrEqual(400);
  });

  it("avoids cutting holes (strip cuts and seams)", () => {
    // 6000 × 3000 plate: the natural middle strip cut (y=1500) runs through a hole
    const region = rectRegion(0, 0, 11000, 3000, [rect(2000, 1400, 2400, 1600), rect(5400, 800, 5800, 1000)]);
    const cands = generateCandidates(region, gen({ allowSolo: false, holePolicy: "reject" }));
    const best = cands.find((c) => c.plan.valid);
    expect(best).toBeDefined();
    expect(codes(best!.plan)).not.toContain("HOLE_CUT");
    expect(best!.plan.input.stripCuts.length).toBeGreaterThan(0);
  });

  it("applies overlap to the limits so every segment still fits", () => {
    const region = rectRegion(0, 0, 9000, 2900);
    const cands = generateCandidates(region, gen({ allowSolo: false, overlap: { enabled: true, mm: 50, side: "alternate" } }));
    const best = cands.find((c) => c.plan.valid)!;
    expect(best).toBeDefined();
    expect(best.plan.metrics.overlapArea).toBeGreaterThan(0);
    expect(best.plan.metrics.unfitSegments).toBe(0);
    expect(best.plan.metrics.finishedArea).toBeCloseTo(9000 * 2900, 3);
  });

  it("tries the raw sheet too, so a part just over the margin limit needs fewer segments", () => {
    const region = rectRegion(0, 0, 5995, 1495); // fits only as a solo (margin-free) segment
    const cands = generateCandidates(region, gen());
    const solo = cands.find((c) => c.limits === "raw")!;
    expect(solo.plan.valid).toBe(true);
    expect(solo.plan.metrics.segments).toBe(1);
    expect(solo.plan.metrics.soloSegments).toBe(1);
    const usable = cands.find((c) => c.limits === "usable")!;
    expect(usable.plan.metrics.segments).toBeGreaterThan(1);
    expect(cands[0].plan.metrics.segments).toBe(1); // default order: fewest segments first
  });

  it("turned-90° layouts are only proposed when the nest allows 90° rotation", () => {
    const region = rectRegion(0, 0, 3000, 3000);
    expect(generateCandidates(region, gen({ sheet: { ...SHEET, ro: 2 } })).some((c) => c.swapped)).toBe(true);
    expect(generateCandidates(region, gen({ sheet: { ...SHEET, ro: 0 } })).some((c) => c.swapped)).toBe(false);
  });

  it("proposes layouts for each user-defined source sheet", () => {
    const region = rectRegion(0, 0, 7000, 1000);
    const cands = generateCandidates(region, gen({ sheet: { sheets: [{ W: 6000, H: 1500 }, { W: 8000, H: 2000 }], mg: 5, ro: 2 } }));
    expect(new Set(cands.map((c) => c.sheetIndex))).toEqual(new Set([0, 1]));
    const big = cands.find((c) => c.sheetIndex === 1 && c.limits === "usable" && !c.swapped)!;
    expect(big.plan.metrics.segments).toBe(1); // fits whole on the 8000 sheet
  });

  it("is deterministic", () => {
    const circle = circleRegion(0, 0, 3760);
    const run = () => generateCandidates(circle, gen()).map((c) => `${c.id}:${c.plan.metrics.segments}:${c.plan.metrics.cutLength.toFixed(3)}`);
    expect(run()).toEqual(run());
  });
});
