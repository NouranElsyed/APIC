import ExcelJS from "exceljs";
import { dayToIso, isoToDay } from "@/features/planning/calendar";
import type { PlanningData } from "@/features/planning/dto";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF10233F" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const BAR = solid("FF1D4ED8");
const CRIT = solid("FFDC2626");
const DONE = solid("FF16A34A");
const BASE = solid("FFB6BEC9");
const WBS_FILL = solid("FFEEF2F7");

const toDate = (iso: string) => new Date(isoToDay(iso) * 86_400_000);

/** Two sheets: the activity table, and a weekly "time schedule" with coloured bars (Primavera-style). */
export async function buildScheduleWorkbook(data: PlanningData, projectLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SteelFlow";
  const codeOf = new Map(data.activities.map((a) => [a.id, a.code]));

  // ---- Sheet 1: schedule table
  const ws = wb.addWorksheet("Schedule", { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });
  ws.addRow([`${projectLabel} — ${data.schedule.name}`]).font = { bold: true, size: 14 };
  ws.addRow([`Data date: ${data.schedule.dataDate}    Progress: ${data.kpis.progress}%    Finish: ${data.kpis.currentFinish ?? "—"}`]);
  ws.addRow([]);
  const headers = ["#", "Activity ID", "Activity Name", "Duration (d)", "Start", "Finish", "% Complete", "Total Float (d)", "Critical", "Baseline Start", "Baseline Finish", "Predecessors"];
  const hr = ws.addRow(headers);
  hr.eachCell((c) => { c.fill = HEADER_FILL; c.font = HEADER_FONT; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
  const actById = new Map(data.activities.map((a) => [a.id, a]));
  for (const r of data.rows) {
    const act = r.kind === "activity" ? actById.get(r.id) : undefined;
    const preds = act ? act.predecessors.map((p) => `${codeOf.get(p.activityId) ?? "?"}${p.type === "FS" ? "" : p.type}${p.lagDays ? (p.lagDays > 0 ? "+" : "") + p.lagDays + "d" : ""}`).join(", ") : "";
    const row = ws.addRow([
      r.outline, r.kind === "activity" ? r.code : "", `${"    ".repeat(r.level)}${r.name}`, r.duration || (r.type ? 0 : ""),
      r.start ? toDate(r.start) : "", r.finish ? toDate(r.finish) : "", r.percent / 100, r.kind === "activity" ? r.float : "",
      r.critical ? "Yes" : "", r.baselineStart ? toDate(r.baselineStart) : "", r.baselineFinish ? toDate(r.baselineFinish) : "", preds,
    ]);
    if (r.kind === "wbs") row.font = { bold: true };
    if (r.kind === "wbs") row.eachCell((c) => { c.fill = WBS_FILL; });
    if (r.critical && r.kind === "activity") row.getCell(3).font = { color: { argb: "FFDC2626" }, bold: true };
  }
  ws.getColumn(1).width = 8; ws.getColumn(2).width = 12; ws.getColumn(3).width = 44;
  [4, 8].forEach((i) => (ws.getColumn(i).width = 13));
  [5, 6, 10, 11].forEach((i) => { ws.getColumn(i).width = 13; ws.getColumn(i).numFmt = "dd mmm yyyy"; });
  ws.getColumn(7).width = 12; ws.getColumn(7).numFmt = "0%";
  ws.getColumn(9).width = 9; ws.getColumn(12).width = 28;

  // ---- Sheet 2: time schedule (weekly columns)
  const gs = wb.addWorksheet("Time Schedule", { views: [{ state: "frozen", ySplit: 3, xSplit: 3 }] });
  const all = data.rows.filter((r) => r.start && r.finish);
  if (all.length) {
    const minDay = Math.min(...all.map((r) => isoToDay(r.baselineStart && r.baselineStart < r.start ? r.baselineStart : r.start)));
    const maxDay = Math.max(...all.map((r) => isoToDay(r.baselineFinish && r.baselineFinish > r.finish ? r.baselineFinish : r.finish)));
    // Weeks start on Sunday to match the Sun–Thu work week.
    const dow = ((minDay + 4) % 7 + 7) % 7;
    const first = minDay - dow;
    const weeks = Math.min(260, Math.ceil((maxDay - first + 1) / 7));
    const fixed = 3;
    gs.addRow([`${projectLabel} — Time Schedule (weekly)`]).font = { bold: true, size: 14 };
    const monthRow = gs.addRow(["", "", ""]);
    const weekRow = gs.addRow(["#", "Activity", "Float"]);
    let lastMonth = "";
    for (let w = 0; w < weeks; w++) {
      const d = first + w * 7;
      const iso = dayToIso(d);
      const month = iso.slice(0, 7);
      monthRow.getCell(fixed + 1 + w).value = month !== lastMonth ? toDate(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) : "";
      lastMonth = month;
      weekRow.getCell(fixed + 1 + w).value = Number(iso.slice(8, 10));
      gs.getColumn(fixed + 1 + w).width = 3.2;
    }
    for (const row of [monthRow, weekRow]) row.eachCell({ includeEmpty: true }, (c, col) => { if (col <= fixed + weeks) { c.fill = HEADER_FILL; c.font = HEADER_FONT; c.alignment = { horizontal: "center" }; } });
    gs.getColumn(1).width = 8; gs.getColumn(2).width = 42; gs.getColumn(3).width = 7;

    const todayCol = Math.floor((isoToDay(data.schedule.dataDate) - first) / 7);
    for (const r of data.rows) {
      const row = gs.addRow([r.outline, `${"  ".repeat(r.level)}${r.name}`, r.kind === "activity" ? r.float : ""]);
      if (r.kind === "wbs") row.eachCell({ includeEmpty: true }, (c, col) => { if (col <= fixed + weeks) { c.fill = WBS_FILL; c.font = { bold: true }; } });
      if (!r.start || !r.finish) continue;
      const s0 = Math.floor((isoToDay(r.start) - first) / 7);
      const f0 = Math.floor((isoToDay(r.finish) - first) / 7);
      const paint = r.done ? DONE : r.critical ? CRIT : BAR;
      for (let w = s0; w <= f0 && w < weeks; w++) row.getCell(fixed + 1 + w).fill = paint;
      if (r.baselineStart && r.baselineFinish && r.kind === "activity") {
        const b0 = Math.floor((isoToDay(r.baselineStart) - first) / 7);
        const b1 = Math.floor((isoToDay(r.baselineFinish) - first) / 7);
        for (let w = b0; w <= b1 && w < weeks; w++) { const c = row.getCell(fixed + 1 + w); if (!c.fill || (c.fill as ExcelJS.FillPattern).pattern !== "solid") c.fill = BASE; }
      }
    }
    if (todayCol >= 0 && todayCol < weeks) {
      for (let rr = 3; rr <= gs.rowCount; rr++) gs.getRow(rr).getCell(fixed + 1 + todayCol).border = { left: { style: "medium", color: { argb: "FFDC2626" } } };
    }
    gs.addRow([]);
    gs.addRow(["", "Legend:  blue = planned · red = critical · green = complete · grey = baseline · red line = data date"]).font = { italic: true, size: 9 };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
