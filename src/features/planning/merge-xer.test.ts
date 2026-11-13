import { describe, expect, it } from "vitest";
import { mergeRelationships, planMerge, type ExistingActivity } from "./merge";
import { parseXer, writeXer, xerToSchedule, type ExportSchedule, type ImportedSchedule } from "./xer";

// Round trip through real XER text: write → parse → merge into a schedule that was built from the same file.

const cal = { id: "cal", p6Id: "10", name: "Std", workDays: [false, true, true, true, true, true, false], holidays: ["2026-12-25"], workExceptions: [], hoursPerDay: 8, isDefault: true };
const wbs = [
  { id: "w1", p6Id: "1", parentId: null, code: "PRJ", name: "Project", sortOrder: 0 },
  { id: "w2", p6Id: "2", parentId: "w1", code: "ENG", name: "Engineering", sortOrder: 10 },
  { id: "w3", p6Id: "3", parentId: "w1", code: "FAB", name: "Fabrication", sortOrder: 20 },
];
const act = (n: number, code: string, wbsId: string, over: Partial<ExportSchedule["activities"][number]> = {}) => ({
  id: `a${n}`, p6Id: String(100 + n), wbsId, calendarId: "cal", code, name: `Activity ${code}`, type: "TASK" as const, durationDays: 5, remainingDays: 5, percentComplete: 0,
  actualStart: null, actualFinish: null, earlyStart: "2026-11-01", earlyFinish: "2026-11-05", lateStart: "2026-11-01", lateFinish: "2026-11-05", totalFloat: 0,
  constraintType: null, constraintDate: null, raw: null, ...over,
});
const schedule = (activities: ExportSchedule["activities"], relationships: ExportSchedule["relationships"] = []): ExportSchedule => ({
  name: "Riser", code: "RISER", startDate: "2026-11-01", dataDate: "2026-11-01", finishDate: "2026-12-01", calendars: [cal], wbs, activities, relationships,
});
const roundTrip = (s: ExportSchedule) => xerToSchedule(parseXer(writeXer(s)));

function existingFrom(imp: ImportedSchedule) {
  const wbsId = (p: string) => `W${p}`;
  return {
    activities: imp.activities.map<ExistingActivity>((a, i) => ({
      id: `DB-${a.code}`, code: a.code, name: a.name, type: a.type, durationDays: a.durationDays, remainingDays: a.remainingDays, percentComplete: a.percentComplete,
      actualStart: a.actualStart, actualFinish: a.actualFinish, constraintType: a.constraintType, constraintDate: a.constraintDate,
      wbsId: a.wbsP6Id ? wbsId(a.wbsP6Id) : null, calendarId: "DB-CAL", sortOrder: i, p6Id: a.p6Id, raw: a.raw,
    })),
    wbs: imp.wbs.map((w) => ({ id: wbsId(w.p6Id), code: w.code, name: w.name, parentId: w.parentP6Id ? wbsId(w.parentP6Id) : null, sortOrder: w.sortOrder, p6Id: w.p6Id })),
    calendars: imp.calendars.map((c) => ({ id: "DB-CAL", name: c.name, p6Id: c.p6Id, workDays: c.workDays, holidays: c.holidays, workExceptions: c.workExceptions, hoursPerDay: c.hoursPerDay })),
  };
}
let n = 0;
const newId = () => `new-${++n}`;
const opts = { keepProgress: false, removeMissing: false };

describe("re-importing an XER into a schedule", () => {
  const first = schedule(
    [act(1, "A100", "w2"), act(2, "A110", "w2"), act(3, "A200", "w3")],
    [{ predecessorId: "a1", successorId: "a2", type: "FS", lagDays: 0 }, { predecessorId: "a2", successorId: "a3", type: "SS", lagDays: 2 }],
  );
  const impA = roundTrip(first);

  it("is a no-op when the file did not change", () => {
    const plan = planMerge(existingFrom(impA), roundTrip(first), opts, newId);
    expect(plan.activitiesCreate).toHaveLength(0);
    expect(plan.activitiesUpdate).toHaveLength(0);
    expect(plan.activitiesRemove).toHaveLength(0);
    expect(plan.keptOnly).toHaveLength(0);
    expect(plan.unchanged).toBe(3);
    expect(plan.wbsCreate).toHaveLength(0);
    expect(plan.wbsUpdate).toHaveLength(0);
    expect(plan.calendarsCreate).toHaveLength(0);
    expect(plan.calendarsUpdate).toHaveLength(0);
  });

  it("applies what changed in P6 and keeps every database id", () => {
    const edited = schedule(
      [
        act(1, "A100", "w2", { percentComplete: 100, remainingDays: 0, actualStart: "2026-11-01", actualFinish: "2026-11-05" }),
        act(2, "A110", "w2", { durationDays: 9 }),
        act(3, "A200", "w3"),
        act(4, "A300", "w3", { name: "Added in P6" }),
      ],
      [{ predecessorId: "a2", successorId: "a3", type: "SS", lagDays: 2 }, { predecessorId: "a3", successorId: "a4", type: "FS", lagDays: 0 }],
    );
    const impB = roundTrip(edited);
    const plan = planMerge(existingFrom(impA), impB, opts, newId);

    expect(plan.activityIds.get(impB.activities[0].p6Id)).toBe("DB-A100");
    expect(plan.activityIds.get(impB.activities[1].p6Id)).toBe("DB-A110");
    expect(plan.activitiesCreate.map((c) => c.a.code)).toEqual(["A300"]);
    const changed = plan.activitiesUpdate.filter((u) => u.businessChange).map((u) => u.id).sort();
    expect(changed).toEqual(["DB-A100", "DB-A110"]);
    expect(plan.unchanged).toBe(1);

    // logic: the A100→A110 link was removed in P6, a new link to the new activity was added
    const rels = mergeRelationships(
      [{ predecessorId: "DB-A100", successorId: "DB-A110", type: "FS", lagDays: 0 }, { predecessorId: "DB-A110", successorId: "DB-A200", type: "SS", lagDays: 2 }],
      impB.relationships, plan.activityIds, new Set(plan.keptOnly),
    );
    expect(rels.rows).toHaveLength(2);
    expect(rels.rows.some((r) => r.predecessorId === "DB-A100")).toBe(false);
    expect(rels.rows.some((r) => r.successorId === plan.activityIds.get(impB.activities[3].p6Id))).toBe(true);
  });

  it("keeps progress entered here when asked to", () => {
    const local = existingFrom(impA);
    local.activities[0] = { ...local.activities[0], percentComplete: 55, remainingDays: 2, actualStart: "2026-11-02" };
    const file = roundTrip(schedule([act(1, "A100", "w2", { durationDays: 6 }), act(2, "A110", "w2"), act(3, "A200", "w3")]));
    const plan = planMerge(local, file, { ...opts, keepProgress: true }, newId);
    const u = plan.activitiesUpdate.find((x) => x.id === "DB-A100")!;
    expect(u.data.durationDays).toBe(6);
    expect("percentComplete" in u.data).toBe(false);
  });
});
