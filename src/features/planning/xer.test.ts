import { describe, expect, it } from "vitest";
import { buildCalendarData, parseCalendarData, parseXer, writeXer, xerToSchedule, type ExportSchedule } from "./xer";

// A hand-made file shaped like a real P6 export (tabs, CRLF, 2 shifts/day, exceptions, Mon–Fri week).
const T = "\t";
const row = (...c: string[]) => ["%R", ...c].join(T);
const SAMPLE = [
  ["ERMHDR", "19.12", "2026-11-01", "Project", "admin", "admin", "dbname", "Project Management", "USD"].join(T),
  "%T" + T + "PROJECT",
  ["%F", "proj_id", "proj_short_name", "clndr_id", "plan_start_date", "last_recalc_date"].join(T),
  row("100", "RISER-01", "10", "2026-11-01 08:00", "2026-11-11 08:00"),
  "%T" + T + "CALENDAR",
  ["%F", "clndr_id", "clndr_name", "day_hr_cnt", "clndr_data"].join(T),
  row("10", "Std 5 Day", "8",
    "(0||CalendarData()(\x7f\x7f(0||DaysOfWeek()(\r\n(0||1()())\r\n(0||2()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||3()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))" +
    "(0||4()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||5()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||6()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||7()()))" +
    "(0||VIEW(ShowTotal|Y)())(0||Exceptions()(\r\n(0||0(d|46381)())(0||1(d|46387)((0||0(s|08:00|f|16:00)())))))))"),
  "%T" + T + "PROJWBS",
  ["%F", "wbs_id", "proj_id", "seq_num", "proj_node_flag", "wbs_short_name", "wbs_name", "parent_wbs_id"].join(T),
  row("1", "100", "0", "Y", "RISER-01", "Riser Duct", ""),
  row("2", "100", "10", "N", "ENG", "Engineering", "1"),
  row("3", "100", "20", "N", "FAB", "Fabrication", "1"),
  row("4", "100", "30", "N", "DRW", "Drawings", "2"),
  "%T" + T + "TASK",
  ["%F", "task_id", "proj_id", "wbs_id", "clndr_id", "task_type", "status_code", "complete_pct_type", "task_code", "task_name", "target_drtn_hr_cnt", "remain_drtn_hr_cnt",
    "act_start_date", "act_end_date", "early_start_date", "early_end_date", "cstr_type", "cstr_date", "my_custom_col"].join(T),
  row("11", "100", "4", "10", "TT_Task", "TK_Complete", "CP_Drtn", "A1000", "Design & Drawings", "160", "0", "2026-11-01 08:00", "2026-11-26 17:00", "", "", "", "", "keep-me"),
  row("12", "100", "2", "10", "TT_Task", "TK_Active", "CP_Drtn", "A1010", "Review", "120", "60", "2026-11-27 08:00", "", "", "", "", "", ""),
  row("13", "100", "3", "10", "TT_Task", "TK_NotStart", "CP_Drtn", "A1020", "Steel Fabrication", "560", "560", "", "", "2026-12-14 08:00", "2027-02-26 17:00", "CS_MSOA", "2026-12-14 08:00", ""),
  row("14", "100", "3", "10", "TT_FinMile", "TK_NotStart", "CP_Drtn", "M1", "Fabrication Complete", "0", "0", "", "", "", "", "", "", ""),
  "%T" + T + "TASKPRED",
  ["%F", "task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt"].join(T),
  row("1", "12", "11", "100", "100", "PR_FS", "0"),
  row("2", "13", "12", "100", "100", "PR_SS", "16"),
  row("3", "14", "13", "100", "100", "PR_FS", "0"),
  "%E",
].join("\r\n");

describe("XER import", () => {
  const s = xerToSchedule(parseXer(SAMPLE));

  it("reads project, calendar, WBS hierarchy", () => {
    expect(s.name).toBe("RISER-01");
    expect(s.startDate).toBe("2026-11-01");
    expect(s.dataDate).toBe("2026-11-11");
    expect(s.calendars).toHaveLength(1);
    expect(s.calendars[0].workDays).toEqual([false, true, true, true, true, true, false]); // Mon–Fri
    expect(s.calendars[0].hoursPerDay).toBe(8);
    expect(s.calendars[0].holidays).toEqual(["2026-12-25"]); // serial 46381
    expect(s.calendars[0].workExceptions).toEqual(["2026-12-31"]);
    expect(s.wbs.map((w) => [w.code, w.parentP6Id])).toEqual([["ENG", null], ["FAB", null], ["DRW", "2"]]);
  });

  it("converts hours → working days, progress, constraints and links", () => {
    const [a, b, c, m] = s.activities;
    expect(a).toMatchObject({ code: "A1000", durationDays: 20, percentComplete: 100, actualFinish: "2026-11-26" });
    expect(b).toMatchObject({ durationDays: 15, remainingDays: 7.5, percentComplete: 50 });
    expect(c).toMatchObject({ durationDays: 70, constraintType: "SNET", constraintDate: "2026-12-14" });
    expect(m).toMatchObject({ type: "MILESTONE_FINISH", durationDays: 0 });
    expect(s.relationships).toEqual([
      { predP6Id: "11", succP6Id: "12", type: "FS", lagDays: 0 },
      { predP6Id: "12", succP6Id: "13", type: "SS", lagDays: 2 },
      { predP6Id: "13", succP6Id: "14", type: "FS", lagDays: 0 },
    ]);
  });

  it("rejects files that are not XER", () => {
    expect(() => xerToSchedule(parseXer("hello"))).toThrow(/PROJECT/);
  });
});

describe("calendar data", () => {
  it("round-trips through build → parse", () => {
    const wd = [true, true, true, true, true, false, false];
    const parsed = parseCalendarData(buildCalendarData(wd, ["2026-12-25", "2027-01-07"], ["2026-12-26"], 8));
    expect(parsed).toMatchObject({ workDays: wd, holidays: ["2026-12-25", "2027-01-07"], workExceptions: ["2026-12-26"], hoursPerDay: 8 });
  });
});

describe("XER export", () => {
  const imported = xerToSchedule(parseXer(SAMPLE));
  const exp: ExportSchedule = {
    name: "Riser Duct", code: "RISER-01", startDate: "2026-11-01", dataDate: "2026-11-11", finishDate: "2027-02-26",
    calendars: imported.calendars.map((c) => ({ id: "cal-" + c.p6Id, p6Id: c.p6Id, ...c, isDefault: true })),
    wbs: imported.wbs.map((w) => ({ id: "wbs-" + w.p6Id, p6Id: w.p6Id, parentId: w.parentP6Id ? "wbs-" + w.parentP6Id : null, code: w.code, name: w.name, sortOrder: w.sortOrder })),
    activities: imported.activities.map((a) => ({
      id: "act-" + a.p6Id, p6Id: a.p6Id, wbsId: a.wbsP6Id ? "wbs-" + a.wbsP6Id : null, calendarId: "cal-10", code: a.code, name: a.name, type: a.type,
      durationDays: a.durationDays, remainingDays: a.remainingDays, percentComplete: a.percentComplete, actualStart: a.actualStart, actualFinish: a.actualFinish,
      earlyStart: a.plannedStart, earlyFinish: a.plannedFinish, lateStart: a.plannedStart, lateFinish: a.plannedFinish, totalFloat: 0,
      constraintType: a.constraintType, constraintDate: a.constraintDate, raw: a.raw,
    })),
    relationships: imported.relationships.map((r) => ({ predecessorId: "act-" + r.predP6Id, successorId: "act-" + r.succP6Id, type: r.type, lagDays: r.lagDays })),
  };
  // A brand-new activity created in the web app (no p6Id) must get a fresh id and survive.
  exp.activities.push({
    id: "new1", p6Id: null, wbsId: "wbs-3", calendarId: null, code: "N1", name: "Added on web", type: "TASK", durationDays: 3, remainingDays: null,
    percentComplete: 0, actualStart: null, actualFinish: null, earlyStart: "2027-03-01", earlyFinish: "2027-03-03", lateStart: "2027-03-01", lateFinish: "2027-03-03",
    totalFloat: 0, constraintType: null, constraintDate: null, raw: null,
  });
  exp.relationships.push({ predecessorId: "act-14", successorId: "new1", type: "FS", lagDays: 1 });

  const text = writeXer(exp);
  const back = xerToSchedule(parseXer(text));

  it("writes a well-formed XER", () => {
    expect(text.startsWith("ERMHDR\t")).toBe(true);
    expect(text.trimEnd().endsWith("%E")).toBe(true);
    for (const t of ["PROJECT", "CALENDAR", "PROJWBS", "TASK", "TASKPRED"]) expect(text).toContain(`%T\t${t}`);
  });

  it("round-trips activities, durations, progress and links", () => {
    expect(back.activities).toHaveLength(5);
    const byCode = Object.fromEntries(back.activities.map((a) => [a.code, a]));
    expect(byCode.A1000).toMatchObject({ durationDays: 20, percentComplete: 100, actualFinish: "2026-11-26" });
    expect(byCode.A1010).toMatchObject({ durationDays: 15, remainingDays: 7.5, percentComplete: 50 });
    expect(byCode.A1020).toMatchObject({ constraintType: "SNET", constraintDate: "2026-12-14" });
    expect(byCode.M1.type).toBe("MILESTONE_FINISH");
    expect(byCode.N1).toMatchObject({ durationDays: 3, percentComplete: 0 });
    expect(back.relationships).toHaveLength(4);
    const id = (code: string) => byCode[code].p6Id;
    expect(back.relationships).toContainEqual({ predP6Id: id("A1000"), succP6Id: id("A1010"), type: "FS", lagDays: 0 });
    expect(back.relationships).toContainEqual({ predP6Id: id("A1010"), succP6Id: id("A1020"), type: "SS", lagDays: 2 });
    expect(back.relationships).toContainEqual({ predP6Id: id("M1"), succP6Id: id("N1"), type: "FS", lagDays: 1 });
  });

  it("keeps ids unique and preserves WBS, calendars and unknown task columns", () => {
    const ids = back.activities.map((a) => a.p6Id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(back.wbs.map((w) => [w.code, w.parentP6Id === null])).toEqual([["ENG", true], ["FAB", true], ["DRW", false]]);
    expect(back.calendars[0]).toMatchObject({ workDays: [false, true, true, true, true, true, false], holidays: ["2026-12-25"], workExceptions: ["2026-12-31"] });
    expect(back.activities.find((a) => a.code === "A1000")!.raw.my_custom_col).toBe("keep-me");
  });
});
