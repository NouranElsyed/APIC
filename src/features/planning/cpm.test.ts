import { describe, expect, it } from "vitest";
import { runCpm } from "./cpm";
import type { ActivityInput, CalendarDef, RelInput } from "./types";

// 2026-11-15 is a Sunday. Default calendar = Sun–Thu (Fri/Sat off).
const cal: CalendarDef = {
  id: "c", name: "Sun–Thu", workDays: [true, true, true, true, true, false, false],
  holidays: [], workExceptions: [], hoursPerDay: 8,
};
const act = (id: string, d: number, extra: Partial<ActivityInput> = {}): ActivityInput => ({
  id, type: "TASK", durationDays: d, remainingDays: null, percentComplete: 0,
  actualStart: null, actualFinish: null, calendarId: null, constraintType: null, constraintDate: null, ...extra,
});
const rel = (p: string, s: string, type: RelInput["type"] = "FS", lagDays = 0): RelInput => ({ predecessorId: p, successorId: s, type, lagDays });
const run = (activities: ActivityInput[], relationships: RelInput[], dataDate = "2026-11-15", calendars = [cal]) =>
  runCpm({ activities, relationships, calendars, defaultCalendarId: "c", projectStart: "2026-11-15", dataDate });

describe("CPM", () => {
  it("chains FS activities and finds float on a parallel path", () => {
    const r = run([act("A", 3), act("B", 2), act("C", 1)], [rel("A", "B")]);
    expect(r.ok).toBe(true);
    expect(r.activities.A).toMatchObject({ earlyStart: "2026-11-15", earlyFinish: "2026-11-17", totalFloat: 0, isCritical: true });
    expect(r.activities.B).toMatchObject({ earlyStart: "2026-11-18", earlyFinish: "2026-11-19", totalFloat: 0, isCritical: true });
    expect(r.activities.C).toMatchObject({ earlyStart: "2026-11-15", earlyFinish: "2026-11-15", totalFloat: 4, isCritical: false });
    expect(r.projectFinish).toBe("2026-11-19");
  });

  it("skips the weekend", () => {
    const r = run([act("A", 5), act("B", 2)], [rel("A", "B")]);
    expect(r.activities.A.earlyFinish).toBe("2026-11-19"); // Sun..Thu
    expect(r.activities.B).toMatchObject({ earlyStart: "2026-11-22", earlyFinish: "2026-11-23" });
  });

  it("honours holidays", () => {
    const withHoliday = { ...cal, holidays: ["2026-11-16"] };
    const r = run([act("A", 3)], [], "2026-11-15", [withHoliday]);
    expect(r.activities.A.earlyFinish).toBe("2026-11-18"); // Sun, Tue, Wed
  });

  it("handles SS+lag and FF", () => {
    const ss = run([act("A", 5), act("B", 3)], [rel("A", "B", "SS", 2)]);
    expect(ss.activities.B).toMatchObject({ earlyStart: "2026-11-17", earlyFinish: "2026-11-19", totalFloat: 0 });
    const ff = run([act("A", 5), act("B", 2)], [rel("A", "B", "FF")]);
    expect(ff.activities.B).toMatchObject({ earlyStart: "2026-11-18", earlyFinish: "2026-11-19" });
  });

  it("applies FS lag", () => {
    const r = run([act("A", 1), act("B", 1)], [rel("A", "B", "FS", 2)]);
    expect(r.activities.B.earlyStart).toBe("2026-11-18"); // A Sun, lag Mon+Tue, B Wed
  });

  it("detects logic loops", () => {
    const r = run([act("A", 1), act("B", 1), act("C", 1)], [rel("A", "B"), rel("B", "A")]);
    expect(r.ok).toBe(false);
    expect(r.cycleIds.sort()).toEqual(["A", "B"]);
  });

  it("keeps actuals for completed work and pushes successors", () => {
    const r = run(
      [act("A", 5, { actualStart: "2026-11-15", actualFinish: "2026-11-17", percentComplete: 100 }), act("B", 2)],
      [rel("A", "B")], "2026-11-18",
    );
    expect(r.activities.A).toMatchObject({ earlyFinish: "2026-11-17", isCritical: false, totalFloat: 0, remainingDays: 0 });
    expect(r.activities.B.earlyStart).toBe("2026-11-18");
  });

  it("schedules remaining duration from the data date for in-progress work", () => {
    const r = run(
      [act("A", 5, { actualStart: "2026-11-15", percentComplete: 40 }), act("B", 1)],
      [rel("A", "B")], "2026-11-18",
    );
    expect(r.activities.A.remainingDays).toBe(3);
    expect(r.activities.A.earlyFinish).toBe("2026-11-22"); // Wed 18, Thu 19, Sun 22
    expect(r.activities.B.earlyStart).toBe("2026-11-23");
  });

  it("does not start unstarted work before the data date", () => {
    const r = run([act("A", 2)], [], "2026-11-22");
    expect(r.activities.A.earlyStart).toBe("2026-11-22");
  });

  it("places milestones correctly", () => {
    const r = run(
      [act("S", 0, { type: "MILESTONE_START" }), act("A", 3), act("M", 0, { type: "MILESTONE_FINISH" })],
      [rel("S", "A"), rel("A", "M")],
    );
    expect(r.activities.S.earlyStart).toBe("2026-11-15");
    expect(r.activities.A).toMatchObject({ earlyStart: "2026-11-15", earlyFinish: "2026-11-17" });
    expect(r.activities.M).toMatchObject({ earlyStart: "2026-11-17", earlyFinish: "2026-11-17", totalFloat: 0 });
    expect(r.activities.S.totalFloat).toBe(0);
  });

  it("applies SNET and FNLT constraints", () => {
    const snet = run([act("A", 2, { constraintType: "SNET", constraintDate: "2026-11-22" })], []);
    expect(snet.activities.A.earlyStart).toBe("2026-11-22");
    const fnlt = run([act("A", 3), act("B", 1, { constraintType: "FNLT", constraintDate: "2026-11-15" })], [rel("A", "B")]);
    expect(fnlt.activities.B.totalFloat).toBeLessThan(0);
    expect(fnlt.activities.B.isCritical).toBe(true);
  });

  it("supports per-activity calendars", () => {
    const sixDay: CalendarDef = { ...cal, id: "six", workDays: [true, true, true, true, true, false, true] };
    const r = run([act("A", 6, { calendarId: "six" })], [], "2026-11-15", [cal, sixDay]);
    expect(r.activities.A.earlyFinish).toBe("2026-11-21"); // Sun..Thu + Sat
  });
});
