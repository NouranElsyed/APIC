import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSettings, runOptimize, type Group, type OptResult, type Pt } from "../nest-boost/engine";
import { nestMetrics } from "../nest-boost/saved-nests";
import { evaluatePlan, measure, piecesFor, type EngineCtx, type EngineEval } from "./evaluate";
import { circleLoop, regionFromPolygon } from "./geometry";
import { generateCandidates, type Candidate, type GenSettings, type Plan } from "./planner";
import { PRIORITY_LABEL, compareRows, differences, explainOrder, rankCandidates, sheetsText, type Priority } from "./rank";
import { installFakeCanvas, removeFakeCanvas } from "./test-canvas";

/* ---------------- fixtures ---------------- */

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 0, gp: 5, cell: 5 };
const gen = (over: Partial<GenSettings> = {}): GenSettings => ({
  directions: ["H", "V"], sheet: SHEET, overlap: { enabled: false, mm: 0, side: "A" }, holePolicy: "reject", allowSolo: true, ...over,
});
const plate = regionFromPolygon(rect(12000, 2980));
const circle = { outer: circleLoop(0, 0, 3760), holes: [] };
const part = { qty: 2, th: 10, material: "S235" };
const ctx: EngineCtx = { mg: 5, gp: 5, cell: 5, ro: 0, pair: false, common: false, timeSec: 0.2 };

const ev = (over: Partial<EngineEval> = {}): EngineEval => ({
  sheets: 5, soloSheets: 0, pieces: 20, unplaced: 0, utilization: 70, scrapPct: 30, sheetAreaM2: 45, partsAreaM2: 31.5,
  sheet: { W: 6000, H: 1500 }, seconds: 2, ...over,
});
/** A candidate with chosen metrics (everything else from a real candidate). */
const fake = (base: Candidate, id: string, m: Partial<Plan["metrics"]> = {}, valid = true): Candidate => ({
  ...base,
  id,
  label: `layout ${id}`,
  plan: { ...base.plan, valid, metrics: { ...base.plan.metrics, ...m } },
});

/* ---------------- ranking (pure) ---------------- */

describe("rankCandidates", () => {
  const real = generateCandidates(circle, gen())[0];
  const A = fake(real, "A", { segments: 10, cutLength: 35000, sheetsLowerBound: 5, soloSegments: 0 });
  const B = fake(real, "B", { segments: 12, cutLength: 30000, sheetsLowerBound: 5, soloSegments: 0 });
  const C = fake(real, "C", { segments: 8, cutLength: 40000, sheetsLowerBound: 6, soloSegments: 2 });
  const D = fake(real, "D", { segments: 6, cutLength: 20000, sheetsLowerBound: 4 }, false);
  const ids = (r: { cand: Candidate }[]) => r.map((x) => x.cand.id);

  it("unchecked layouts: by the area estimate, then seams, then segments; invalid ones last", () => {
    const r = rankCandidates([C, D, A, B], new Map(), "sheets");
    expect(ids(r)).toEqual(["B", "A", "C", "D"]); // lb 5, 5, 6; B has shorter seams than A
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(r.map((x) => x.status)).toEqual(["ok", "ok", "ok", "invalid"]);
    expect(r[0].sheetsKind).toBe("estimate");
    expect(r[3].sheetsKind).toBe("none");
  });

  it("layouts checked with the engine come first, by the REAL sheet count", () => {
    const evals = new Map<string, EngineEval | null>([["C", ev({ sheets: 4 })], ["A", ev({ sheets: 6 })]]);
    const r = rankCandidates([A, B, C], evals, "sheets");
    expect(ids(r)).toEqual(["C", "A", "B"]); // C (4) and A (6) are real; B is only an estimate, so it follows
    expect(r[0].sheetsKind).toBe("engine");
    expect(r[2].sheetsKind).toBe("estimate");
  });

  it("the priority decides what comes first", () => {
    const evals = new Map<string, EngineEval | null>([["A", ev({ sheets: 5 })], ["B", ev({ sheets: 6 })], ["C", ev({ sheets: 7 })]]);
    expect(ids(rankCandidates([A, B, C], evals, "sheets"))).toEqual(["A", "B", "C"]);
    expect(ids(rankCandidates([A, B, C], evals, "seams"))).toEqual(["B", "A", "C"]); // B 30 m < A 35 m < C 40 m
    expect(ids(rankCandidates([A, B, C], evals, "segments"))).toEqual(["C", "A", "B"]); // 8 < 10 < 12
  });

  it("equal sheets and seams: fewer segments, then better utilization", () => {
    const X = fake(real, "X", { segments: 10, cutLength: 35000 });
    const Y = fake(real, "Y", { segments: 9, cutLength: 35000 });
    const evals = new Map<string, EngineEval | null>([["X", ev({ sheets: 5 })], ["Y", ev({ sheets: 5 })]]);
    expect(ids(rankCandidates([X, Y], evals, "sheets"))).toEqual(["Y", "X"]);
    const P = fake(real, "P", { segments: 10, cutLength: 35000 });
    const Q = fake(real, "Q", { segments: 10, cutLength: 35000 });
    const e2 = new Map<string, EngineEval | null>([["P", ev({ utilization: 60 })], ["Q", ev({ utilization: 72 })]]);
    expect(ids(rankCandidates([P, Q], e2, "sheets"))).toEqual(["Q", "P"]);
  });

  it("seams within 1 mm count as equal", () => {
    const X = fake(real, "X", { segments: 12, cutLength: 35000 });
    const Y = fake(real, "Y", { segments: 10, cutLength: 35000.4 });
    expect(ids(rankCandidates([X, Y], new Map(), "seams"))).toEqual(["Y", "X"]);
  });

  it("a layout the engine could not nest completely goes after the ones that nest", () => {
    const evals = new Map<string, EngineEval | null>([["A", ev({ sheets: 3, unplaced: 2 })], ["B", ev({ sheets: 9 })]]);
    const r = rankCandidates([A, B, C], evals, "sheets");
    expect(ids(r)).toEqual(["B", "C", "A"]); // B: real and complete; C: estimate only; A: engine left 2 pieces un-nested
    expect(r.find((x) => x.cand.id === "A")!.status).toBe("unnested");
    expect(sheetsText(r.find((x) => x.cand.id === "A")!)).toBe("2 pieces could not be nested");
  });

  it("a failed check (null) is treated as not checked", () => {
    const r = rankCandidates([A], new Map([["A", null]]), "sheets");
    expect(r[0].sheetsKind).toBe("estimate");
    expect(r[0].engine).toBeNull();
  });

  it("labels", () => {
    expect(Object.values(PRIORITY_LABEL)).toEqual(["Fewest sheets", "Shortest seams", "Fewest segments"]);
    const [r] = rankCandidates([A], new Map([["A", ev({ sheets: 5, utilization: 71.234 })]]), "sheets");
    expect(sheetsText(r)).toBe("5 sheets · 71.2 % used");
    const [e] = rankCandidates([A], new Map(), "sheets");
    expect(sheetsText(e)).toBe("≥ 5 sheets (area estimate)");
  });
});

/* ---------------- explanations ---------------- */

describe("explanations", () => {
  const real = generateCandidates(circle, gen())[0];
  const mk = (id: string, m: Partial<Plan["metrics"]>) => fake(real, id, m);
  const A = mk("A", { segments: 10, cutLength: 35660, sheetsLowerBound: 5, soloSegments: 0 });
  const B = mk("B", { segments: 12, cutLength: 31440, sheetsLowerBound: 6, soloSegments: 0 });

  it("says exactly what differs between two layouts, from the first one's point of view", () => {
    const r = rankCandidates([A, B], new Map([["A", ev({ sheets: 5, utilization: 71 })], ["B", ev({ sheets: 6, utilization: 62 })]]), "sheets");
    const d = differences(r[0], r[1]).map((x) => x.text);
    expect(d).toEqual([
      "1 sheet fewer (5 vs 6, checked with the nesting engine)",
      "71.0 % of the sheet area used vs 62.0 %",
      "4.22 m longer seams (35.66 vs 31.44 m)",
      "2 segments fewer (10 vs 12)",
    ]);
    const back = differences(r[1], r[0]);
    expect(back.map((x) => x.better)).toEqual([false, false, true, false]);
  });

  it("does not compare an engine result with an estimate as if they were equal kinds", () => {
    const r = rankCandidates([A, B], new Map([["A", ev({ sheets: 5 })]]), "sheets");
    const d = differences(r[0], r[1]);
    expect(d[0].text).toMatch(/not comparable/);
  });

  it("explainOrder: headline, #1, comparison with #2, the best on other factors, and the limits", () => {
    const evals = new Map<string, EngineEval | null>([["A", ev({ sheets: 5 })], ["B", ev({ sheets: 6 })]]);
    const x = explainOrder(rankCandidates([A, B], evals, "sheets"), "sheets", 2);
    expect(x.headline).toBe("Ordered by fewest sheets, then shortest seams, then fewest segments.");
    expect(x.bullets[0]).toMatch(/^#1 is “layout A”: 5 sheets · 70.0 % used, 10 segments, 35.66 m of seams\.$/);
    expect(x.bullets[1]).toMatch(/^Compared with #2: 1 sheet fewer/);
    expect(x.bullets.join(" ")).toMatch(/Shortest seams: #2 “layout B”/); // B has shorter seams but needs a sheet more
    expect(x.limits.join(" ")).toMatch(/not a cost optimum/);
    expect(x.limits.join(" ")).toMatch(/short randomised run \(2 s per layout\)/);
    expect(x.limits.join(" ")).toMatch(/nested on its own/);
  });

  it("explainOrder warns about estimates and about layouts the engine could not nest", () => {
    const r = rankCandidates([A, B, mk("C", {})], new Map([["C", ev({ unplaced: 3 })]]), "seams");
    const x = explainOrder(r, "seams");
    expect(x.headline).toContain("shortest seams");
    expect(x.limits[0]).toMatch(/2 layouts still show area estimates/);
    expect(x.limits.join(" ")).toMatch(/1 layout could not be nested completely/);
  });

  it("explainOrder of an empty list is just the headline and limits", () => {
    const x = explainOrder([], "segments");
    expect(x.bullets).toEqual([]);
    expect(x.headline).toContain("fewest segments");
  });
});

describe("compareRows", () => {
  const real = generateCandidates(circle, gen())[0];
  const A = fake(real, "A", { segments: 10, cutLength: 35660, soloSegments: 0, sheetsLowerBound: 5 });
  const B = fake(real, "B", { segments: 12, cutLength: 31440, soloSegments: 1, sheetsLowerBound: 6 });
  const row = (rows: ReturnType<typeof compareRows>, l: string) => rows.find((r) => r.label === l)!;

  it("highlights the best value of each factor", () => {
    const rs = rankCandidates([A, B], new Map([["A", ev({ sheets: 5, utilization: 71, scrapPct: 29 })], ["B", ev({ sheets: 6, utilization: 62, scrapPct: 38 })]]), "sheets");
    const rows = compareRows(rs);
    expect(row(rows, "Sheets")).toMatchObject({ cells: ["5", "6"], best: [0] });
    expect(row(rows, "Sheet area used")).toMatchObject({ cells: ["71.0 %", "62.0 %"], best: [0] });
    expect(row(rows, "Scrap").best).toEqual([0]);
    expect(row(rows, "Segments")).toMatchObject({ cells: ["10", "12"], best: [0] });
    expect(row(rows, "Seam length (m)")).toMatchObject({ cells: ["35.66", "31.44"], best: [1] });
    expect(row(rows, "Solo segments").best).toEqual([0]);
    expect(row(rows, "Largest piece (mm)").best).toEqual([]);
  });

  it("estimates are shown as ≥ and are not compared with engine numbers", () => {
    const mixed = rankCandidates([A, B], new Map([["A", ev({ sheets: 5 })]]), "sheets");
    const sheets = row(compareRows(mixed), "Sheets");
    expect(sheets.cells).toEqual(["5", "≥ 6"]);
    expect(sheets.best).toEqual([]);
    const est = rankCandidates([A, B], new Map(), "sheets");
    expect(row(compareRows(est), "Sheets")).toMatchObject({ cells: ["≥ 5", "≥ 6"], best: [0] });
    expect(row(compareRows(est), "Sheet area used").cells).toEqual(["—", "—"]);
  });

  it("no value is 'best' when all are equal", () => {
    const rs = rankCandidates([A, fake(real, "A2", { segments: 10, cutLength: 35660, soloSegments: 0, sheetsLowerBound: 5 })], new Map(), "sheets");
    expect(row(compareRows(rs), "Segments").best).toEqual([]);
  });
});

/* ---------------- evaluating with the real engine ---------------- */

describe("evaluatePlan (real runOptimize)", () => {
  beforeAll(installFakeCanvas);
  afterAll(removeFakeCanvas);

  const best = (r = plate): Candidate => generateCandidates(r, gen({ directions: ["H", "V"], allowSolo: false })).find((c) => c.plan.valid)!;

  it("turns the segments into temporary parts with the original's quantity, thickness and material", () => {
    const c = best();
    const groups = piecesFor(c.plan, part);
    expect(groups).toHaveLength(c.plan.segments.length);
    expect(groups.map((g) => g.name)).toEqual(c.plan.segments.map((s) => s.id));
    expect(groups.every((g) => g.qty === 2 && g.th === 10 && g.material === "S235")).toBe(true);
    expect(groups.map((g) => g.id)).toEqual(groups.map((_, i) => i + 1));
    expect(Math.min(...groups[0].outer.map((p) => p[0]))).toBe(0);
    expect(piecesFor(c.plan, { ...part, qty: 0 })[0].qty).toBe(1); // evaluates one original when the quantity is 0
  });

  it("nests every piece × quantity and agrees with the nest's own metrics", async () => {
    const c = best();
    let captured: OptResult | null = null;
    const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 });
    const out = await evaluatePlan(c.plan, part, { W: 6000, H: 1500 }, ctx, {
      run: async (g, o) => (captured = await runOptimize(g, o)),
    });
    expect(out).not.toBeNull();
    const e = out!;
    expect(e.unplaced).toBe(0);
    expect(e.pieces).toBe(2 * c.plan.segments.length);
    expect(e.sheet).toEqual({ W: 6000, H: 1500 });
    expect(e.seconds).toBeGreaterThanOrEqual(0);
    // never fewer sheets than the area allows
    expect(e.sheets).toBeGreaterThanOrEqual(Math.ceil((2 * c.plan.metrics.cutArea) / (5990 * 1490) - 1e-9));
    // same numbers as the saved-nests table
    const nm = nestMetrics(captured!, S);
    expect(e.sheets).toBe(nm.sheets);
    expect(e.utilization).toBeCloseTo(nm.utilization, 9);
    expect(e.scrapPct).toBeCloseTo(nm.scrapPct, 9);
    expect(e.sheetAreaM2).toBeCloseTo(nm.sheetAreaM2, 9);
    expect(e.partsAreaM2).toBeCloseTo(nm.partsAreaM2, 9);
    expect(e.utilization + e.scrapPct).toBeCloseTo(100, 9);
  }, 30000);

  it("more originals need at least as many sheets; a bigger sheet never needs more", async () => {
    const c = best();
    const one = await evaluatePlan(c.plan, { ...part, qty: 1 }, { W: 6000, H: 1500 }, ctx);
    const four = await evaluatePlan(c.plan, { ...part, qty: 4 }, { W: 6000, H: 1500 }, ctx);
    expect(four!.sheets).toBeGreaterThanOrEqual(one!.sheets);
    expect(four!.pieces).toBe(4 * c.plan.segments.length);
    const big = await evaluatePlan(c.plan, { ...part, qty: 4 }, { W: 12000, H: 3000 }, ctx);
    expect(big!.sheets).toBeLessThanOrEqual(four!.sheets);
  }, 30000);

  it("returns null for an invalid layout or when stopped", async () => {
    const c = best();
    expect(await evaluatePlan({ ...c.plan, valid: false }, part, { W: 6000, H: 1500 }, ctx)).toBeNull();
    expect(await evaluatePlan({ ...c.plan, segments: [] }, part, { W: 6000, H: 1500 }, ctx)).toBeNull();
    expect(await evaluatePlan(c.plan, part, { W: 6000, H: 1500 }, ctx, { shouldStop: () => true })).toBeNull();
  });

  it("reports pieces the engine could not place", async () => {
    const c = best();
    const g: Group = piecesFor(c.plan, part)[0];
    const out = await evaluatePlan(c.plan, part, { W: 6000, H: 1500 }, ctx, { run: async () => ({ sheets: [], un: [g, g], skip: [] }) });
    expect(out).toMatchObject({ sheets: 0, unplaced: 2, pieces: 0, utilization: 0 });
  });

  it("measure() handles an empty result", () => {
    expect(measure({ sheets: [], un: [], skip: [] }, makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 }))).toMatchObject({ sheets: 0, utilization: 0, scrapPct: 0 });
  });

  it("the engine result feeds the ranking: real counts replace the estimates", async () => {
    const cands = generateCandidates(plate, gen({ directions: ["H", "V"], allowSolo: true })).filter((c) => c.plan.valid).slice(0, 3);
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const evals = new Map<string, EngineEval | null>();
    for (const c of cands) evals.set(c.id, await evaluatePlan(c.plan, part, c.plan.input.sheet.sheets[c.sheetIndex], ctx));
    const r = rankCandidates(cands, evals, "sheets");
    expect(r.every((x) => x.sheetsKind === "engine")).toBe(true);
    const counts = r.map((x) => x.sheets!);
    expect(counts).toEqual([...counts].sort((a, b) => a - b)); // listed by real sheet count
    const x = explainOrder(r, "sheets", 0.2);
    expect(x.bullets[0]).toContain("#1 is");
    expect(x.limits.join(" ")).toMatch(/randomised/);
  }, 60000);
});

describe("priority type", () => {
  it("has the three measurable priorities", () => {
    const all: Priority[] = ["sheets", "seams", "segments"];
    expect(all.map((p) => PRIORITY_LABEL[p])).toHaveLength(3);
  });
});
