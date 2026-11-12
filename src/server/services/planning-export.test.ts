import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildScheduleWorkbook } from "./planning-export.service";
import { buildAlerts, buildMilestones, buildRows, buildSCurve, computeKpis, wbsProgress, type MetricActivity, type MetricInput } from "@/features/planning/metrics";
import type { PlanActivityDTO, PlanningData } from "@/features/planning/dto";

const cal = { id: "c", name: "Sun–Thu", workDays: [true, true, true, true, true, false, false], holidays: [], workExceptions: [], hoursPerDay: 8, isDefault: true };
const act = (id: string, wbsId: string, d: number, s: string, f: string, extra: Partial<PlanActivityDTO> = {}): PlanActivityDTO => ({
  id, wbsId, calendarId: null, code: id.toUpperCase(), name: `Activity ${id}`, type: "TASK", durationDays: d, remainingDays: d, percentComplete: 0,
  actualStart: null, actualFinish: null, constraintType: null, constraintDate: null, earlyStart: s, earlyFinish: f, lateStart: s, lateFinish: f,
  totalFloat: 0, isCritical: false, predecessors: [], ...extra,
});

describe("schedule workbook", () => {
  it("writes the activity table and a weekly time-schedule sheet", async () => {
    const wbs = [{ id: "w1", parentId: null, code: "1", name: "Engineering", sortOrder: 1 }];
    const activities = [
      act("a", "w1", 10, "2026-11-15", "2026-11-26", { percentComplete: 100, actualStart: "2026-11-15", actualFinish: "2026-11-26" }),
      act("b", "w1", 20, "2026-11-29", "2026-12-24", { isCritical: true, predecessors: [{ relId: "r1", activityId: "a", type: "FS", lagDays: 0 }] }),
    ];
    const metricActs: MetricActivity[] = activities.map((a) => ({ ...a, remainingDays: a.remainingDays }));
    const mi: MetricInput = { activities: metricActs, wbs, calendars: [cal], defaultCalendarId: "c", dataDate: "2026-11-30", baseline: { a: { start: "2026-11-15", finish: "2026-11-26" }, b: { start: "2026-11-29", finish: "2026-12-20" } }, snapshots: [] };
    const data: PlanningData = {
      schedule: { id: "s", name: "Test", startDate: "2026-11-15", dataDate: "2026-11-30", finishDate: "2026-12-24", source: "NATIVE", calcError: null, defaultCalendarId: "c" },
      calendars: [cal], wbs, activities, baseline: { id: "b", name: "B1", createdAt: new Date().toISOString() },
      rows: buildRows(mi, new Map([["a", 0], ["b", 1]])), kpis: computeKpis(mi), scurve: buildSCurve(mi), wbsProgress: wbsProgress(mi),
      alerts: buildAlerts(mi), milestones: buildMilestones(mi), criticalPath: [],
    };
    const buf = await buildScheduleWorkbook(data, "PRJ-001 — Riser Duct");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Schedule", "Time Schedule"]);
    const s = wb.getWorksheet("Schedule")!;
    expect(s.getRow(4).getCell(3).value).toBe("Activity Name");
    expect(String(s.getRow(5).getCell(3).value)).toContain("Engineering");
    expect(s.getRow(7).getCell(12).value).toBe("A"); // predecessor of B
    expect(wb.getWorksheet("Time Schedule")!.rowCount).toBeGreaterThan(5);
  });
});
