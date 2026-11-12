import { describe, expect, it } from "vitest";
import { buildAlerts, buildMilestones, buildRows, buildSCurve, computeKpis, plannedPercentAt, weightedProgress, wbsProgress, type MetricActivity, type MetricInput } from "./metrics";
import type { CalendarDef } from "./types";

const cal: CalendarDef = { id: "c", name: "x", workDays: [true, true, true, true, true, false, false], holidays: [], workExceptions: [], hoursPerDay: 8 };
const A = (id: string, wbsId: string | null, d: number, s: string, f: string, extra: Partial<MetricActivity> = {}): MetricActivity => ({
  id, wbsId, code: id, name: `Act ${id}`, type: "TASK", calendarId: null, durationDays: d, remainingDays: d, percentComplete: 0,
  actualStart: null, actualFinish: null, earlyStart: s, earlyFinish: f, totalFloat: 0, isCritical: false, ...extra,
});
const base = (activities: MetricActivity[], o: Partial<MetricInput> = {}): MetricInput => ({
  activities, wbs: [{ id: "w1", parentId: null, code: "E", name: "Eng", sortOrder: 1 }, { id: "w2", parentId: null, code: "F", name: "Fab", sortOrder: 2 }],
  calendars: [cal], defaultCalendarId: "c", dataDate: "2026-11-18", baseline: null, snapshots: [], ...o,
});

describe("progress", () => {
  it("weights by duration", () => {
    const acts = [A("a", "w1", 10, "2026-11-15", "2026-11-26", { percentComplete: 100 }), A("b", "w1", 30, "2026-11-29", "2027-01-07", { percentComplete: 0 })];
    expect(weightedProgress(acts)).toBeCloseTo(25);
  });
  it("plans linearly across working days", () => {
    // 5 working days Sun–Thu 15–19 Nov: end of Tue 17 = 3/5
    const input = base([A("a", "w1", 5, "2026-11-15", "2026-11-19")]);
    const day = (iso: string) => Math.round(Date.parse(iso) / 86_400_000);
    expect(plannedPercentAt(input, day("2026-11-14"), "plan")).toBe(0);
    expect(plannedPercentAt(input, day("2026-11-17"), "plan")).toBeCloseTo(60);
    expect(plannedPercentAt(input, day("2026-11-25"), "plan")).toBe(100);
  });
});

describe("kpis, delay and SPI", () => {
  const acts = [
    A("a", "w1", 5, "2026-11-15", "2026-11-19", { percentComplete: 100, actualStart: "2026-11-15", actualFinish: "2026-11-19" }),
    A("b", "w2", 5, "2026-11-22", "2026-11-26", { percentComplete: 20, actualStart: "2026-11-22", isCritical: true, totalFloat: 0 }),
  ];
  const baseline = { a: { start: "2026-11-15", finish: "2026-11-19" }, b: { start: "2026-11-22", finish: "2026-11-26" } };
  it("computes SPI against the baseline and delay vs baseline finish", () => {
    const late = acts.map((a) => (a.id === "b" ? { ...a, earlyFinish: "2026-12-03" } : a));
    const k = computeKpis(base(late, { baseline, dataDate: "2026-11-26" }));
    expect(k.hasBaseline).toBe(true);
    expect(k.delayDays).toBe(7);
    expect(k.progress).toBeCloseTo(60);
    expect(k.spi).toBeCloseTo(0.6, 1);
    expect(k.completed).toBe(1);
    expect(k.inProgress).toBe(1);
    expect(k.criticalCount).toBe(1);
    expect(k.plannedFinish).toBe("2026-11-26");
  });
  it("flags delayed activities in alerts", () => {
    const late = acts.map((a) => (a.id === "b" ? { ...a, earlyFinish: "2026-12-03" } : a));
    const alerts = buildAlerts(base(late, { baseline, dataDate: "2026-11-26" }));
    expect(alerts[0]).toMatchObject({ kind: "DELAYED", id: "b", note: "+7 days behind baseline" });
    expect(alerts.some((x) => x.kind === "COMPLETED" && x.id === "a")).toBe(true);
  });
  it("has no delay without a baseline", () => {
    expect(computeKpis(base(acts)).delayDays).toBe(0);
  });
});

describe("s-curve", () => {
  it("is monotonic, starts at 0, ends at 100 and ends the actual line at the data date", () => {
    const input = base([A("a", "w1", 20, "2026-11-15", "2026-12-10"), A("b", "w2", 20, "2026-12-13", "2027-01-07")], { dataDate: "2026-11-25" });
    const s = buildSCurve(input);
    expect(s.points[0].plan).toBe(0);
    expect(s.points[s.points.length - 1].plan).toBe(100);
    for (let i = 1; i < s.points.length; i++) expect(s.points[i].plan).toBeGreaterThanOrEqual(s.points[i - 1].plan);
    expect(s.actual[s.actual.length - 1].day).toBe(s.dataDay);
  });
});

describe("rows, wbs and milestones", () => {
  const acts = [
    A("a", "w1", 5, "2026-11-15", "2026-11-19", { percentComplete: 100, actualFinish: "2026-11-19", actualStart: "2026-11-15" }),
    A("b", "w1", 5, "2026-11-22", "2026-11-26"),
    A("c", "w2", 10, "2026-11-29", "2026-12-10"),
    A("m1", "w1", 0, "2026-11-19", "2026-11-19", { type: "MILESTONE_FINISH", percentComplete: 100, actualFinish: "2026-11-19" }),
    A("m2", "w2", 0, "2026-12-10", "2026-12-10", { type: "MILESTONE_FINISH" }),
  ];
  it("builds an outlined tree with roll-ups", () => {
    const rows = buildRows(base(acts), new Map(acts.map((a, i) => [a.id, i])));
    expect(rows.map((r) => r.outline)).toEqual(["1", "1.1", "1.2", "1.3", "2", "2.1", "2.2"]);
    const eng = rows[0];
    expect(eng).toMatchObject({ kind: "wbs", start: "2026-11-15", finish: "2026-11-26", percent: 50 });
  });
  it("rolls up top-level WBS progress", () => {
    expect(wbsProgress(base(acts)).map((w) => [w.code, w.progress])).toEqual([["E", 50], ["F", 0]]);
  });
  it("lists done then next then upcoming milestones", () => {
    expect(buildMilestones({ activities: acts }).map((m) => m.status)).toEqual(["DONE", "NEXT"]);
  });
});
