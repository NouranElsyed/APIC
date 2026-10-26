import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addManualPart,
  buildManualShape,
  leftOf,
  makeSettings,
  placedCounts,
  problemMessages,
  runOptimize,
  syncUnplaced,
  type Group,
  type OptResult,
  type Pt,
} from "../nest-boost/engine";
import { decodeSnapshot, encodeSnapshot } from "../nest-boost/persist";
import { buildReport2D } from "../report/report-2d";
import { parseNestParts } from "../../takeoff/nest-parts";
import { childrenOf, commitSegmentation, expandRemoval, isSegChild, isSegParent, patchGroup, removeSegmentation, savedPlan, segSignature, withoutSeg } from "./commit";
import { classifyFit, gridCapacity } from "./fit";
import { regionArea } from "./geometry";
import { groupToRegion } from "./group-region";
import { generateCandidates, type Plan } from "./planner";
import { installFakeCanvas, removeFakeCanvas } from "./fake-canvas";

/* ---------------- fixtures ---------------- */

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const plate = (id: number, w: number, h: number, qty: number, name = `PART-00${id}`): Group => ({
  id, sn: id, name, qty, th: 10, material: "S235", outer: rect(w, h), holes: [], w, h, area: w * h, per: 2 * (w + h),
});
// the nest's spacing and grid cell matter: the optimiser can only place pieces up to gridCapacity (< usable area)
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 0, gp: 5, cell: 5 };
const bestPlan = (g: Group): Plan => {
  const c = generateCandidates(groupToRegion(g).region, {
    directions: ["H", "V"], sheet: SHEET, overlap: { enabled: false, mm: 0, side: "A" }, holePolicy: "reject", allowSolo: false,
  }).find((x) => x.plan.valid);
  if (!c) throw new Error("no valid layout");
  return c.plan;
};
const counters = () => ({ id: 100, sn: 10 });
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return r as Extract<T, { ok: true }>;
};

/* ---------------- commitSegmentation ---------------- */

describe("commitSegmentation", () => {
  const parent = plate(1, 12000, 2980, 3, "PLATE-001");
  const other = plate(2, 500, 500, 4, "OTHER");

  it("keeps the original, adds one piece per segment right under it, quantity = original's", () => {
    const plan = bestPlan(parent);
    const r = ok(commitSegmentation({ groups: [parent, other], parentId: 1, plan, counters: counters() }));
    const n = plan.segments.length;
    expect(r.groups).toHaveLength(2 + n);
    expect(r.groups.map((g) => g.id)).toEqual([1, ...r.children.map((c) => c.id), 2]); // parent, its pieces, then the rest
    expect(r.groups[r.groups.length - 1]).toBe(other); // untouched parts are the same objects

    expect(isSegParent(r.parent)).toBe(true);
    expect(r.parent.qty).toBe(3); // the takeoff still sees ONE original of qty 3
    expect(r.parent.outer).toBe(parent.outer); // geometry untouched
    expect(r.parent.seg!.childIds).toEqual(r.children.map((c) => c.id));
    expect(r.parent.seg!.sig).toBe(segSignature(parent));

    r.children.forEach((c, i) => {
      expect(isSegChild(c)).toBe(true);
      expect(c.name).toBe(`PLATE-001-${plan.segments[i].id}`);
      expect(c.seg).toMatchObject({ role: "child", parentId: 1, segId: plan.segments[i].id, planId: r.parent.seg!.planId });
      expect(c.qty).toBe(3); // each original needs one of each piece
      expect(c.th).toBe(10);
      expect(c.material).toBe("S235");
    });
    expect(new Set(r.groups.map((g) => g.id)).size).toBe(r.groups.length); // unique ids
    expect(r.counters).toEqual({ id: 100 + n, sn: 10 + n });
    expect(r.children.map((c) => c.sn)).toEqual(Array.from({ length: n }, (_, i) => 11 + i));
    expect(r.removedIds).toEqual([]);
  });

  it("pieces carry real, valid geometry whose areas add up to the original", () => {
    const plan = bestPlan(parent);
    const r = ok(commitSegmentation({ groups: [parent], parentId: 1, plan, counters: counters() }));
    expect(r.children.reduce((s, c) => s + c.area, 0)).toBeCloseTo(parent.area, 3);
    for (const c of r.children) {
      expect(c.outer.length).toBeGreaterThanOrEqual(4);
      expect(Math.min(...c.outer.map((p) => p[0]))).toBe(0); // like every imported part: starts at 0,0
      expect(c.w).toBeGreaterThan(0);
      expect(["READY", "READY_SOLO"]).toContain(classifyFit(c, makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 })).status);
    }
  });

  it("stores the plan on the original so it can be re-opened", () => {
    const plan = bestPlan(parent);
    const r = ok(commitSegmentation({ groups: [parent], parentId: 1, plan, counters: counters() }));
    const saved = savedPlan(r.parent)!;
    expect(saved.stripCuts).toEqual(plan.input.stripCuts);
    expect(saved.seamCuts).toEqual(plan.input.seamCuts);
    expect(savedPlan(parent)).toBeNull();
    expect(savedPlan(r.children[0])).toBeNull();
  });

  it("refuses (and changes nothing) for an invalid plan, a missing part, or a piece", () => {
    const bad: Plan = { ...bestPlan(parent), valid: false, issues: [{ code: "SEGMENT_TOO_LARGE", severity: "error", message: "Segment S01 does not fit" }] };
    const groups = [parent];
    const r = commitSegmentation({ groups, parentId: 1, plan: bad, counters: counters() });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/1 error: Segment S01 does not fit/);
    expect(groups).toEqual([parent]);
    expect(commitSegmentation({ groups, parentId: 9, plan: bestPlan(parent), counters: counters() }).ok).toBe(false);
    const done = ok(commitSegmentation({ groups, parentId: 1, plan: bestPlan(parent), counters: counters() }));
    expect(commitSegmentation({ groups: done.groups, parentId: done.children[0].id, plan: bestPlan(parent), counters: counters() }).ok).toBe(false);
  });

  it("segmenting again replaces the old pieces and reports them", () => {
    const first = ok(commitSegmentation({ groups: [parent, other], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    const second = ok(commitSegmentation({ groups: first.groups, parentId: 1, plan: bestPlan(parent), counters: first.counters }));
    expect(second.removedIds.sort()).toEqual(first.children.map((c) => c.id).sort());
    expect(second.groups.some((g) => first.children.some((c) => c.id === g.id))).toBe(false);
    expect(childrenOf(second.groups, 1)).toHaveLength(second.children.length);
    expect(second.groups).toHaveLength(2 + second.children.length);
  });

  it("pieces are made from the CUT geometry: a gap makes them smaller, the original is untouched", () => {
    const c = generateCandidates(groupToRegion(parent).region, {
      directions: ["H", "V"], sheet: SHEET, overlap: { enabled: true, mm: -4, side: "A" }, holePolicy: "reject", allowSolo: false,
    }).find((x) => x.plan.valid)!;
    const r = ok(commitSegmentation({ groups: [parent], parentId: 1, plan: c.plan, counters: counters() }));
    const piecesArea = r.children.reduce((s, x) => s + x.area, 0);
    expect(piecesArea).toBeCloseTo(c.plan.metrics.cutArea, 3);
    expect(piecesArea).toBeLessThan(parent.area);
    expect(r.parent.area).toBe(parent.area); // takeoff area unchanged
    expect(r.parent.qty).toBe(3);
  });

  it("a part with quantity 0 gives pieces with quantity 0", () => {
    const zero = ok(commitSegmentation({ groups: [{ ...parent, qty: 0 }], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    expect(zero.children.every((c) => c.qty === 0)).toBe(true);
  });
});

/* ---------------- undo, edits, deletion ---------------- */

describe("undo / edit / delete rules", () => {
  const parent = plate(1, 12000, 2980, 3, "PLATE-001");
  const done = ok(commitSegmentation({ groups: [parent, plate(2, 500, 500, 1)], parentId: 1, plan: bestPlan(parent), counters: counters() }));

  it("removeSegmentation restores a plain original and drops only its pieces", () => {
    const r = removeSegmentation(done.groups, 1);
    expect(r.removedIds.sort()).toEqual(done.children.map((c) => c.id).sort());
    expect(r.groups.map((g) => g.id)).toEqual([1, 2]);
    expect(r.groups[0].seg).toBeUndefined();
    expect("seg" in r.groups[0]).toBe(false);
    expect(r.groups[0].qty).toBe(3);
    expect(removeSegmentation(r.groups, 1).groups).toBe(r.groups); // nothing to undo
    expect(removeSegmentation(done.groups, 2).removedIds).toEqual([]); // not an original
  });

  it("editing the original's qty / thickness / material updates its pieces; a piece cannot be edited alone", () => {
    const g1 = patchGroup(done.groups, 1, { qty: 5, th: 12, material: "S355" });
    expect(g1[0]).toMatchObject({ qty: 5, th: 12, material: "S355" });
    for (const c of childrenOf(g1, 1)) expect(c).toMatchObject({ qty: 5, th: 12, material: "S355" });
    expect(g1.find((g) => g.id === 2)).toBe(done.groups.find((g) => g.id === 2));
    // a piece keeps following the original
    const c0 = done.children[0].id;
    expect(patchGroup(done.groups, c0, { qty: 99, th: 1, material: "X" })).toBe(done.groups);
    // other fields of a piece can still change
    const renamed = patchGroup(done.groups, c0, { name: "custom", qty: 99 });
    expect(renamed.find((g) => g.id === c0)).toMatchObject({ name: "custom", qty: 3 });
    // ordinary parts behave as before
    expect(patchGroup(done.groups, 2, { qty: 7 }).find((g) => g.id === 2)!.qty).toBe(7);
    expect(patchGroup(done.groups, 77, { qty: 1 })).toBe(done.groups);
  });

  it("deleting an original takes its pieces; a piece alone is refused", () => {
    const c0 = done.children[0].id;
    const a = expandRemoval(done.groups, [1]);
    expect(a.ids.sort()).toEqual([1, ...done.children.map((c) => c.id)].sort());
    expect(a.blocked).toEqual([]);
    const b = expandRemoval(done.groups, [c0]);
    expect(b.ids).toEqual([]);
    expect(b.blocked).toEqual([c0]);
    const c = expandRemoval(done.groups, [1, c0, 2]);
    expect(c.ids.sort()).toEqual([1, 2, ...done.children.map((x) => x.id)].sort());
    expect(expandRemoval(done.groups, [2]).ids).toEqual([2]);
  });

  it("a duplicate is a plain part", () => {
    const copy = withoutSeg(done.parent);
    expect("seg" in copy).toBe(false);
    expect(copy.name).toBe(done.parent.name);
  });
});

/* ---------------- the nesting engine ---------------- */

describe("the nesting engine nests the pieces, never the original", () => {
  beforeAll(installFakeCanvas);
  afterAll(removeFakeCanvas);

  const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 });
  const opts = (base: OptResult | null = null) => ({ S, pair: false, common: false, timeSec: 0.05, base, shouldStop: () => false, onBest: () => {}, onStatus: () => {} });

  it("nests qty × pieces, nothing for the original, no 'not nested' message", async () => {
    const parent = plate(1, 12000, 2980, 3, "PLATE-001");
    const plan = bestPlan(parent);
    const r = ok(commitSegmentation({ groups: [parent], parentId: 1, plan, counters: counters() }));
    const res = (await runOptimize(r.groups, opts())) as OptResult;
    expect(res.un).toHaveLength(0);
    expect(res.skip).toEqual([]);
    const placed = placedCounts(res);
    expect(placed.get(1)).toBeUndefined(); // the original is not on any sheet
    for (const c of r.children) expect(placed.get(c.id)).toBe(3); // qty 3 of EACH piece, not multiplied further
    expect(res.sheets.flatMap((s) => s.items).length).toBe(3 * r.children.length);
    expect(problemMessages(res, S)).toEqual([]);
    expect(leftOf(r.parent, placed)).toBe(0);
    for (const c of r.children) expect(leftOf(c, placed)).toBe(0);
  });

  it("the original alone gives 'nothing to nest' and never counts as left to place", async () => {
    const parent = plate(1, 12000, 2980, 3, "PLATE-001");
    const r = ok(commitSegmentation({ groups: [parent], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    expect(await runOptimize([r.parent], opts())).toBeNull();
    const res: OptResult = { sheets: [], un: [], skip: [] };
    syncUnplaced(res, r.groups);
    expect(res.un.filter((g) => g.id === 1)).toHaveLength(0);
    expect(res.un.length).toBe(3 * r.children.length); // only the pieces are still to place
  });

  it("a segmented original with quantity 0 is not reported as skipped", async () => {
    const parent = plate(1, 12000, 2980, 0, "PLATE-001");
    const r = ok(commitSegmentation({ groups: [parent, plate(2, 500, 500, 2)], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    const res = (await runOptimize(r.groups, opts())) as OptResult;
    // part #1 is the segmented original; its pieces (same quantity 0) are named PLATE-001-Sxx
    expect(res.skip.some((m) => m.startsWith("Part #1 ("))).toBe(false);
    expect(res.skip.length).toBe(r.children.length); // only the pieces are reported as quantity 0
  });

  it("without segmentation the oversized original still fails as before (regression)", async () => {
    const parent = plate(1, 12000, 2980, 1);
    const res = (await runOptimize([parent], opts())) as OptResult;
    expect(res.un).toHaveLength(1);
    expect(problemMessages(res, S).join(" ")).toMatch(/NOT nested/);
  });
});

/* ---------------- parts are never merged into a segmented one ---------------- */

describe("merging", () => {
  it("a new part with the same shape as a segmented original is added separately", () => {
    const geo = buildManualShape({ kind: "rect", w: 12000, h: 2980 }) as { w: number; h: number };
    const parent: Group = { ...plate(1, geo.w, geo.h, 2, "PLATE-001") };
    const done = ok(commitSegmentation({ groups: [parent], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    const c = { id: 500, sn: 50 };
    const added = addManualPart(done.groups, { kind: "rect", w: 12000, h: 2980 }, { th: 10, material: "S235", qty: 1 }, c);
    expect("error" in added).toBe(false);
    if ("error" in added) return;
    expect(added.merged).toBe(false);
    expect(added.groups.find((g) => g.id === 1)!.qty).toBe(2); // the original's quantity did not change
    // control: without segmentation the same part DOES merge
    const plain = addManualPart([parent], { kind: "rect", w: 12000, h: 2980 }, { th: 10, material: "S235", qty: 1 }, { id: 500, sn: 50 });
    expect("error" in plain || plain.merged).toBe(true);
  });
});

/* ---------------- persistence ---------------- */

describe("persistence", () => {
  const cfg = { W: "6000", H: "1500", mg: "5", gp: "5", cell: "5", ro: "0" } as unknown as Parameters<typeof encodeSnapshot>[0]["cfg"];
  const snap = (groups: Group[], c = { id: 200, sn: 20 }) =>
    encodeSnapshot({ cfg, units: "1", groups, counters: c, savedSeq: 0, importedIds: [], result: null, resS: null, savedNests: [], activeNestId: null });

  it("the segmentation survives a save / load (through JSON, like the database)", () => {
    const parent = plate(1, 12000, 2980, 3, "PLATE-001");
    const done = ok(commitSegmentation({ groups: [parent], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    const back = decodeSnapshot(JSON.parse(JSON.stringify(snap(done.groups))))!;
    expect(back.groups).toHaveLength(done.groups.length);
    const p = back.groups[0];
    expect(isSegParent(p)).toBe(true);
    expect(p.seg!.childIds).toEqual(done.parent.seg!.childIds);
    expect(savedPlan(p)!.stripCuts).toEqual(savedPlan(done.parent)!.stripCuts);
    expect(back.groups.slice(1).every(isSegChild)).toBe(true);
    expect(back.groups[1].name).toBe(done.children[0].name);
    expect(back.groups[1].qty).toBe(3);
  });

  it("old snapshots without any segmentation load unchanged", () => {
    const groups = [plate(1, 500, 400, 2), plate(2, 300, 300, 1)];
    const back = decodeSnapshot(JSON.parse(JSON.stringify(snap(groups))))!;
    expect(back.groups).toEqual(groups);
    expect(back.groups.every((g) => g.seg === undefined)).toBe(true);
  });

  it("a restored original can be undone and re-opened", () => {
    const parent = plate(1, 12000, 2980, 3, "PLATE-001");
    const done = ok(commitSegmentation({ groups: [parent], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    const back = decodeSnapshot(JSON.parse(JSON.stringify(snap(done.groups))))!;
    expect(removeSegmentation(back.groups, 1).groups).toHaveLength(1);
    const again = ok(commitSegmentation({ groups: back.groups, parentId: 1, plan: bestPlan(parent), counters: back.counters }));
    expect(again.removedIds).toHaveLength(done.children.length);
  });
});

/* ---------------- Standard Calculations / takeoff safety ---------------- */

describe("takeoff: the original stays the only item (no double counting)", () => {
  it("parseNestParts lists the original and not its pieces; weight basis stays qty × original", () => {
    const parent = plate(1, 3000, 1000, 3, "PLATE-001"); // area 3 m²
    const done = ok(commitSegmentation({ groups: [parent, plate(2, 500, 500, 4, "OTHER")], parentId: 1, plan: bestPlan(plate(1, 12000, 2980, 3)), counters: counters() }));
    const parts = parseNestParts(JSON.parse(JSON.stringify(encodeSnapshot({
      cfg: {} as never, units: "1", groups: done.groups, counters: done.counters, savedSeq: 0, importedIds: [], result: null, resS: null, savedNests: [], activeNestId: null,
    }))));
    expect(parts.map((p) => p.name)).toEqual(["PLATE-001", "OTHER"]); // pieces are not plates of their own
    const orig = parts.find((p) => p.name === "PLATE-001")!;
    expect(orig.qty).toBe(3);
    expect(orig.qty * orig.area).toBe(3 * 3000 * 1000); // e.g. 100 kg × 3 stays 300 kg, never 4 × 3 × …
    expect(done.children.length).toBeGreaterThan(1);
  });

  it("without segmentation parseNestParts is unchanged", () => {
    const parts = parseNestParts({ groups: [plate(1, 500, 400, 2), plate(2, 300, 300, 1)] });
    expect(parts).toHaveLength(2);
  });
});

/* ---------------- 2D report ---------------- */

describe("2D report", () => {
  it("lists the pieces, not the segmented original", async () => {
    const S = { W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0, x0: 0, GW: 0, GH: 0 } as Parameters<typeof buildReport2D>[0]["S"];
    const parent = plate(1, 12000, 2980, 2, "PLATE-001");
    const done = ok(commitSegmentation({ groups: [parent, plate(2, 500, 500, 4, "OTHER")], parentId: 1, plan: bestPlan(parent), counters: counters() }));
    const first = done.children[0];
    const result: OptResult = { sheets: [{ items: [{ g: first, rot: 0, x: 0, y: 0 }], th: 10, material: "S235", used: 0 }], un: [], skip: [] };
    const blob = await buildReport2D({ result, S, groups: done.groups });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await blob.arrayBuffer()) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const rows: string[] = [];
    wb.getWorksheet("Parts")!.eachRow((row, n) => { if (n > 1) rows.push(String(row.getCell(2).value)); });
    expect(rows).toContain(first.name);
    expect(rows).toContain("OTHER");
    expect(rows).not.toContain("PLATE-001");
  });
});

/* ---------------- cone flat patterns (arcs rebuilt exactly) ---------------- */

describe("cone flat patterns", () => {
  const cone = (d1: number, d2: number, h: number): Group => {
    const g = buildManualShape({ kind: "cone", d1, d2, h }) as { outer: Pt[]; holes: Pt[][]; w: number; h: number; area: number; per: number };
    return { id: 1, sn: 1, name: `Cone ${d1}/${d2}x${h}`, qty: 2, th: 8, material: "S235", ...g };
  };
  const exactArea = (d1: number, d2: number, h: number) => {
    const slant = Math.hypot(h, (d1 - d2) / 2);
    const R = (slant * d1) / (d1 - d2);
    const r = R - slant;
    return 0.5 * ((Math.PI * d1) / R) * (R * R - r * r);
  };

  it("rebuilds the outer and inner arcs of a ring sector and of a pointed cone exactly", () => {
    for (const [d1, d2, h] of [[3000, 1000, 2000], [3000, 0, 2000]] as const) {
      const g = cone(d1, d2, h);
      const r = groupToRegion(g);
      expect(r.fidelity).toBe("arcs");
      expect(r.arcs).toBe(d2 > 0 ? 2 : 1);
      expect(regionArea(r.region)).toBeCloseTo(exactArea(d1, d2, h), 1); // the polygon was ~200 mm² smaller
      expect(g.area).toBeLessThan(exactArea(d1, d2, h));
    }
  });

  it("a cone flat pattern wider than the sheet is segmented into valid pieces that keep their arcs", () => {
    const g = cone(3000, 1000, 2000);
    expect(classifyFit(g, makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 2 })).status).toBe("NEEDS_SEGMENTATION");
    const sheet = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 };
    const c = generateCandidates(groupToRegion(g).region, { directions: ["H", "V"], sheet, overlap: { enabled: false, mm: 0, side: "A" }, holePolicy: "reject", allowSolo: false }).find((x) => x.plan.valid)!;
    expect(c).toBeDefined();
    expect(c.plan.metrics.finishedArea).toBeCloseTo(exactArea(3000, 1000, 2000), 1);
    const done = ok(commitSegmentation({ groups: [g], parentId: 1, plan: c.plan, counters: counters() }));
    expect(done.children.length).toBe(c.plan.segments.length);
    expect(done.children.every((x) => x.qty === 2)).toBe(true);
    // pieces cut from the outer arc still have exact arcs in the plan geometry
    expect(c.plan.segments.some((s) => s.cut.outer.some((e) => e.arc))).toBe(true);
  });
});

/* ---------------- what the optimiser can really place ---------------- */

describe("grid capacity (the largest piece the engine can place on a margined sheet)", () => {
  beforeAll(installFakeCanvas);
  afterAll(removeFakeCanvas);

  const places = async (S: ReturnType<typeof makeSettings>, w: number, h: number) => {
    const g = plate(1, w, h, 1);
    const r = (await runOptimize([g], { S, pair: false, common: false, timeSec: 0.3, base: null, shouldStop: () => false, onBest: () => {}, onStatus: () => {} })) as OptResult;
    return r.un.length === 0 && !r.sheets[0]?.solo;
  };

  // [cell, spacing, capacity measured with the engine on a 600 × 300 sheet with 5 mm margins (usable 590 × 290)]
  it.each([
    [5, 5, 587.5],
    [5, 3, 583.5],
    [10, 10, 585],
    [10, 5, 577.5],
    [20, 5, 557.5],
  ])("cell %i, spacing %i: the formula gives %f and the engine agrees", async (cell, gp, cap) => {
    expect(gridCapacity(600, 5, gp, cell)).toBeCloseTo(cap, 9);
    const S = makeSettings({ W: 600, H: 300, mg: 5, gp, cell, ro: 0 });
    expect(await places(S, cap, 100)).toBe(true); // exactly the capacity is placed …
    expect(await places(S, cap + 0.5, 100)).toBe(false); // … half a millimetre more is not ("no free position")
    expect(await places(S, 100, gridCapacity(300, 5, gp, cell))).toBe(true);
    expect(await places(S, 100, gridCapacity(300, 5, gp, cell) + 0.5)).toBe(false);
  });

  it("without spacing the whole usable area is available", () => {
    expect(gridCapacity(600, 5, 0, 5)).toBe(590);
    expect(gridCapacity(600, 5, 0, 1)).toBe(590);
  });

  it("a part between the capacity and the usable area is reported as needing segmentation, with the reason", () => {
    const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 });
    const r = classifyFit(plate(1, 5990, 1000, 1), S); // usable 5990 × 1490 but placeable only 5987.5 × 1487.5
    expect(r.status).toBe("NEEDS_SEGMENTATION");
    expect(r.detail).toMatch(/not the optimiser's grid/);
    expect(r.detail).toMatch(/5987.5/);
    expect(classifyFit(plate(1, 5987, 1000, 1), S).status).toBe("READY");
  });

  it("segments are sized to the capacity, so the engine places every one of them", async () => {
    const S = makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 0 });
    const parent = plate(1, 12000, 2980, 1, "PLATE-001");
    const plan = bestPlan(parent);
    for (const s of plan.segments) {
      expect(s.bbox[2] - s.bbox[0]).toBeLessThanOrEqual(gridCapacity(6000, 5, 5, 5) + 1e-6);
      expect(s.bbox[3] - s.bbox[1]).toBeLessThanOrEqual(gridCapacity(1500, 5, 5, 5) + 1e-6);
    }
    const r = ok(commitSegmentation({ groups: [parent], parentId: 1, plan, counters: counters() }));
    const res = (await runOptimize(r.groups, { S, pair: false, common: false, timeSec: 5, base: null, shouldStop: () => false, onBest: () => {}, onStatus: () => {} })) as OptResult;
    expect(res.un).toHaveLength(0);
  }, 30000);
});
