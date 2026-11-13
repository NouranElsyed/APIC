import { describe, expect, it } from "vitest";
import { mergeRelationships, planMerge, type ExistingActivity, type ExistingCalendar, type ExistingWbs } from "./merge";
import type { ImportedActivity, ImportedSchedule } from "./xer";

let n = 0;
const newId = () => `new-${++n}`;
const base = { keepProgress: false, removeMissing: false };

const act = (over: Partial<ImportedActivity> & { p6Id: string; code: string }): ImportedActivity => ({
  wbsP6Id: "w1", calendarP6Id: "c1", name: over.code, type: "TASK", durationDays: 5, remainingDays: 5, percentComplete: 0,
  actualStart: null, actualFinish: null, plannedStart: null, plannedFinish: null, constraintType: null, constraintDate: null, sortOrder: 0, raw: { a: "1" }, ...over,
});
const imp = (activities: ImportedActivity[]): ImportedSchedule => ({
  name: "P", code: "P", p6ProjectId: "1", startDate: "2026-01-01", dataDate: null, defaultCalendarP6Id: "c1",
  calendars: [{ p6Id: "c1", name: "Std", workDays: [false, true, true, true, true, true, false], holidays: [], workExceptions: [], hoursPerDay: 8 }],
  wbs: [{ p6Id: "w1", parentP6Id: null, code: "ENG", name: "Engineering", sortOrder: 0 }, { p6Id: "w2", parentP6Id: "w1", code: "DRW", name: "Drawings", sortOrder: 1 }],
  activities, relationships: [], warnings: [], projects: [],
});
const exAct = (over: Partial<ExistingActivity> & { id: string; code: string }): ExistingActivity => ({
  name: over.code, type: "TASK", durationDays: 5, remainingDays: 5, percentComplete: 0, actualStart: null, actualFinish: null, constraintType: null, constraintDate: null,
  wbsId: "W-ENG", calendarId: "C-STD", sortOrder: 0, p6Id: over.id, raw: { a: "1" }, ...over,
});
const exWbs: ExistingWbs[] = [{ id: "W-ENG", code: "ENG", name: "Engineering", parentId: null, sortOrder: 0, p6Id: "w1" }, { id: "W-DRW", code: "DRW", name: "Drawings", parentId: "W-ENG", sortOrder: 1, p6Id: "w2" }];
const exCal: ExistingCalendar[] = [{ id: "C-STD", name: "Std", p6Id: "c1", workDays: [false, true, true, true, true, true, false], holidays: [], workExceptions: [], hoursPerDay: 8 }];

describe("planMerge", () => {
  it("matches by Activity ID, keeps database ids and reports nothing when nothing changed", () => {
    const p = planMerge({ activities: [exAct({ id: "A1", code: "A1000", sortOrder: 0 })], wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "11", code: "A1000" })]), base, newId);
    expect(p.activityIds.get("11")).toBe("A1");
    expect(p.activitiesCreate).toHaveLength(0);
    expect(p.activitiesUpdate).toHaveLength(1); // p6Id differs (A1 → 11) — a bookkeeping-only change
    expect(p.activitiesUpdate[0].businessChange).toBe(false);
    expect(p.wbsCreate).toHaveLength(0);
    expect(p.calendarsCreate).toHaveLength(0);
    expect(p.calendarsUpdate).toHaveLength(0);
  });

  it("counts a genuinely identical activity as unchanged", () => {
    const p = planMerge({ activities: [exAct({ id: "A1", code: "A1000", p6Id: "11" })], wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "11", code: "A1000" })]), base, newId);
    expect(p.unchanged).toBe(1);
    expect(p.activitiesUpdate).toHaveLength(0);
  });

  it("updates changed values, creates new activities and keeps unlisted ones", () => {
    const existing = [exAct({ id: "A1", code: "A1000", p6Id: "11" }), exAct({ id: "A2", code: "LOCAL-1", sortOrder: 1, p6Id: null, raw: null })];
    const p = planMerge({ activities: existing, wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "11", code: "A1000", durationDays: 9, percentComplete: 40 }), act({ p6Id: "12", code: "A1010" })]), base, newId);
    const u = p.activitiesUpdate.find((x) => x.id === "A1")!;
    expect(u.businessChange).toBe(true);
    expect(u.data).toMatchObject({ durationDays: 9, percentComplete: 40 });
    expect(p.activitiesCreate.map((c) => c.a.code)).toEqual(["A1010"]);
    expect(p.keptOnly).toEqual(["A2"]);
    expect(p.activitiesRemove).toEqual([]);
    // the kept activity moves behind the two from the file
    expect(p.keptSort).toEqual([{ id: "A2", sortOrder: 2 }]);
  });

  it("removes activities missing from the file only when asked", () => {
    const existing = [exAct({ id: "A1", code: "A1000", p6Id: "11" }), exAct({ id: "A2", code: "GONE", sortOrder: 1 })];
    const p = planMerge({ activities: existing, wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "11", code: "A1000" })]), { ...base, removeMissing: true }, newId);
    expect(p.activitiesRemove).toEqual(["A2"]);
    expect(p.keptOnly).toEqual([]);
  });

  it("keepProgress leaves progress fields alone but still updates logic fields", () => {
    const existing = [exAct({ id: "A1", code: "A1000", p6Id: "11", percentComplete: 60, actualStart: "2026-01-04", remainingDays: 2 })];
    const p = planMerge({ activities: existing, wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "11", code: "A1000", durationDays: 8, percentComplete: 0, remainingDays: 8 })]), { ...base, keepProgress: true }, newId);
    const d = p.activitiesUpdate[0].data;
    expect(d.durationDays).toBe(8);
    expect("percentComplete" in d).toBe(false);
    expect("actualStart" in d).toBe(false);
    expect("remainingDays" in d).toBe(false);
  });

  it("without keepProgress the file's progress wins", () => {
    const existing = [exAct({ id: "A1", code: "A1000", p6Id: "11", percentComplete: 60 })];
    const p = planMerge({ activities: existing, wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "11", code: "A1000", percentComplete: 80, remainingDays: 1 })]), base, newId);
    expect(p.activitiesUpdate[0].data).toMatchObject({ percentComplete: 80, remainingDays: 1 });
  });

  it("gives a new activity a unique code when it collides with a kept one", () => {
    const p = planMerge({ activities: [exAct({ id: "A1", code: "X" })], wbs: exWbs, calendars: exCal }, imp([act({ p6Id: "1", code: "X" }), act({ p6Id: "2", code: "X" })]), base, newId);
    expect(p.activityIds.get("1")).toBe("A1");
    expect(p.activitiesCreate[0].code).toBe("X-2");
  });

  it("matches WBS by code path, creates missing ones parents-first and updates renamed ones", () => {
    const i = imp([act({ p6Id: "11", code: "A1" })]);
    i.wbs = [
      { p6Id: "w1", parentP6Id: null, code: "ENG", name: "Engineering & Design", sortOrder: 0 },
      { p6Id: "w9", parentP6Id: "w8", code: "QA", name: "QA", sortOrder: 3 },
      { p6Id: "w8", parentP6Id: "w1", code: "FAB", name: "Fabrication", sortOrder: 2 },
    ];
    const p = planMerge({ activities: [], wbs: exWbs, calendars: exCal }, i, base, newId);
    expect(p.wbsUpdate).toEqual([{ id: "W-ENG", data: { code: "ENG", name: "Engineering & Design", sortOrder: 0, parentId: null, p6Id: "w1" } }]);
    expect(p.wbsCreate.map((c) => c.w.code)).toEqual(["FAB", "QA"]);
    expect(p.wbsIds.get("w9")).not.toBe(p.wbsIds.get("w8"));
  });

  it("does not confuse same-coded WBS under different parents", () => {
    const ex: ExistingWbs[] = [
      { id: "R1", code: "1", name: "Phase 1", parentId: null, sortOrder: 0, p6Id: null },
      { id: "R2", code: "2", name: "Phase 2", parentId: null, sortOrder: 1, p6Id: null },
      { id: "C1", code: "A", name: "Under 1", parentId: "R1", sortOrder: 2, p6Id: null },
      { id: "C2", code: "A", name: "Under 2", parentId: "R2", sortOrder: 3, p6Id: null },
    ];
    const i = imp([]);
    i.wbs = [
      { p6Id: "a", parentP6Id: null, code: "2", name: "Phase 2", sortOrder: 0 },
      { p6Id: "b", parentP6Id: "a", code: "A", name: "Under 2", sortOrder: 1 },
    ];
    const p = planMerge({ activities: [], wbs: ex, calendars: exCal }, i, base, newId);
    expect(p.wbsIds.get("b")).toBe("C2");
    expect(p.wbsIds.get("a")).toBe("R2");
  });

  it("matches calendars by id or name and updates changed ones", () => {
    const i = imp([act({ p6Id: "1", code: "A" })]);
    i.calendars = [{ ...i.calendars[0], workDays: [false, true, true, true, true, false, false] }, { p6Id: "c2", name: "Night", workDays: [true, true, true, true, true, true, true], holidays: [], workExceptions: [], hoursPerDay: 8 }];
    const p = planMerge({ activities: [], wbs: exWbs, calendars: exCal }, i, base, newId);
    expect(p.calendarsUpdate.map((c) => c.id)).toEqual(["C-STD"]);
    expect(p.calendarsCreate.map((c) => c.cal.name)).toEqual(["Night"]);
  });
});

describe("mergeRelationships", () => {
  const ids = new Map([["1", "A1"], ["2", "A2"]]);
  it("takes the file's logic, drops file-to-file links that are not in it, and keeps links of web-only activities", () => {
    const existing = [
      { predecessorId: "A1", successorId: "A2", type: "FS" as const, lagDays: 0 }, // not in the file any more → dropped
      { predecessorId: "A2", successorId: "LOCAL", type: "FS" as const, lagDays: 2 }, // touches a web-only activity → kept
    ];
    const r = mergeRelationships(existing, [{ predP6Id: "1", succP6Id: "2", type: "SS", lagDays: 3 }], ids, new Set(["LOCAL"]));
    expect(r.rows).toEqual([
      { predecessorId: "A1", successorId: "A2", type: "SS", lagDays: 3 },
      { predecessorId: "A2", successorId: "LOCAL", type: "FS", lagDays: 2 },
    ]);
    expect(r.fromFile).toBe(1);
    expect(r.kept).toBe(1);
  });
  it("ignores links to activities that are not in the schedule and self-links", () => {
    const r = mergeRelationships([], [{ predP6Id: "1", succP6Id: "99", type: "FS", lagDays: 0 }, { predP6Id: "1", succP6Id: "1", type: "FS", lagDays: 0 }], ids, new Set());
    expect(r.rows).toEqual([]);
  });
  it("de-duplicates repeated links", () => {
    const r = mergeRelationships([], [{ predP6Id: "1", succP6Id: "2", type: "FS", lagDays: 0 }, { predP6Id: "1", succP6Id: "2", type: "FS", lagDays: 0 }], ids, new Set());
    expect(r.rows).toHaveLength(1);
  });
});
