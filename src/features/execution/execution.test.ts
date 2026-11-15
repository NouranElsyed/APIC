import { describe, expect, it } from "vitest";
import { evaluatePreflight, freezeBudget, planBoqSchedule, type ApprovedQuotation, type BoqItem, type PreflightInput } from "./execution";

const q = (o: Partial<ApprovedQuotation> = {}): ApprovedQuotation => ({ number: "Q-1", revision: 0, currency: "EGP", total: 1000, supply: 700, install: 300, ...o });
const item = (o: Partial<BoqItem> = {}): BoqItem => ({ description: "Plates", material: null, type: "SUPPLY", qty: 1, unit: "kg", ...o });
const nest = { hasResult: true, lines: 2, exact: 5, approx: 0, approxNames: [] as string[] };
const base = (o: Partial<PreflightInput> = {}): PreflightInput => ({ stage: "TENDERING", approved: [q()], boqItems: 3, scheduleActivities: null, nest, ...o });

describe("freezeBudget", () => {
  it("sums the approved quotations", () => {
    const b = freezeBudget([q(), q({ number: "Q-2", total: 500, supply: 500, install: 0 })], "2026-11-14");
    expect(b).toMatchObject({ currency: "EGP", total: 1500, supply: 1200, install: 300, frozenAt: "2026-11-14" });
    expect("quotations" in b && b.quotations).toHaveLength(2);
  });
  it("refuses mixed currencies and no quotations", () => {
    expect(freezeBudget([q(), q({ currency: "USD" })], "x")).toHaveProperty("error");
    expect(freezeBudget([], "x")).toHaveProperty("error");
  });
});

describe("evaluatePreflight", () => {
  it("is clean when everything is in place", () => expect(evaluatePreflight(base())).toEqual({ blockers: [], warnings: [] }));
  it("blocks without an approved quotation", () => expect(evaluatePreflight(base({ approved: [] })).blockers[0]).toMatch(/Approve a quotation/));
  it("blocks a project already in execution", () => expect(evaluatePreflight(base({ stage: "EXECUTION" })).blockers[0]).toMatch(/already in execution/));
  it("blocks mixed currencies", () => expect(evaluatePreflight(base({ approved: [q(), q({ currency: "USD" })] })).blockers.join(" ")).toMatch(/currencies/));
  it("warns about approximate parts (does not block)", () => {
    const r = evaluatePreflight(base({ nest: { ...nest, approx: 2, approxNames: ["a", "b"] } }));
    expect(r.blockers).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["APPROXIMATE_PARTS"]);
    expect(r.warnings[0].text).toContain("2 of 7");
  });
  it("warns about a missing nest, missing BOQ and an existing schedule", () => {
    const r = evaluatePreflight(base({ nest: { ...nest, hasResult: false, lines: 0 }, boqItems: 0, scheduleActivities: 12 }));
    expect(r.warnings.map((w) => w.code).sort()).toEqual(["NO_BOQ", "NO_NEST", "SCHEDULE_EXISTS"]);
  });
  it("an empty existing schedule is not worth a warning", () => expect(evaluatePreflight(base({ scheduleActivities: 0 })).warnings).toEqual([]));
});

describe("planBoqSchedule", () => {
  const items = [item({ description: "Riser", material: "ST37" }), item({ description: "Duct" }), item({ description: "Install riser", type: "INSTALL" })];
  const p = planBoqSchedule(items, { supplyDays: 14, installDays: 10 });

  it("builds start → supply → gate → install → finish with unique codes", () => {
    expect(p.activities.map((a) => a.key)).toEqual(["start", "s0", "s1", "supplyDone", "i0", "finish"]);
    expect(new Set(p.activities.map((a) => a.code)).size).toBe(p.activities.length);
    expect(p.activities[0].code).toBe("A1000");
  });
  it("links supply after the start, install after the gate, finish after the installs", () => {
    const by = Object.fromEntries(p.activities.map((a) => [a.key, a]));
    expect(by.s0.after).toEqual(["start"]);
    expect(by.supplyDone.after).toEqual(["s0", "s1"]);
    expect(by.i0.after).toEqual(["supplyDone"]);
    expect(by.finish.after).toEqual(["i0"]);
  });
  it("uses the default durations and names with the material", () => {
    expect(p.activities.find((a) => a.key === "s0")).toMatchObject({ name: "Riser — ST37", durationDays: 14, wbsKey: "SUPPLY" });
    expect(p.activities.find((a) => a.key === "i0")).toMatchObject({ durationDays: 10, wbsKey: "INSTALL" });
  });
  it("creates only the WBS that are used", () => {
    expect(p.wbs.map((w) => w.name)).toEqual(["Supply & Fabrication", "Dismantle & Install"]);
    expect(planBoqSchedule([item()], { supplyDays: 5, installDays: 5 }).wbs).toHaveLength(1);
  });
  it("a supply-only BOQ finishes after the supply items", () => {
    const only = planBoqSchedule([item(), item({ description: "b" })], { supplyDays: 5, installDays: 5 });
    expect(only.activities.map((a) => a.key)).toEqual(["start", "s0", "s1", "finish"]);
    expect(only.activities.at(-1)!.after).toEqual(["s0", "s1"]);
  });
  it("an install-only BOQ starts the installs after the start", () => {
    const only = planBoqSchedule([item({ type: "INSTALL" })], { supplyDays: 5, installDays: 5 });
    expect(only.activities.find((a) => a.key === "i0")!.after).toEqual(["start"]);
  });
  it("returns nothing for an empty BOQ and refuses a huge one", () => {
    expect(planBoqSchedule([], { supplyDays: 1, installDays: 1 }).activities).toEqual([]);
    expect(() => planBoqSchedule(Array.from({ length: 301 }, () => item()), { supplyDays: 1, installDays: 1 })).toThrow(/limited to 300/);
  });
  it("never produces a duration below one day", () => expect(planBoqSchedule([item()], { supplyDays: 0.2, installDays: 0 }).activities[1].durationDays).toBe(1));
});
