// Primavera P6 XER import / export.
//
// XER is a tab-separated text format: `%T table`, `%F field names`, `%R row values`, `%E` end.
// Durations are stored in HOURS (we convert to working days with the activity's calendar),
// dates as `YYYY-MM-DD HH:MM`, calendars as a nested "clndr_data" string.
//
// Tables handled: PROJECT, CALENDAR, PROJWBS, TASK, TASKPRED.
// Not carried (yet): resources, activity codes, user fields, cost accounts — an exported
// file therefore opens in P6 as a clean, logic-complete schedule without those.

import { dayToIso, DEFAULT_WORK_DAYS, isoToDay } from "./calendar";
import type { ActivityType, RelType } from "./types";

// ----------------------------------------------------------------------------- raw parse

export interface XerTable { name: string; fields: string[]; rows: Record<string, string>[] }
export interface XerFile { header: string[]; tables: Record<string, XerTable> }

export function parseXer(text: string): XerFile {
  // Some exporters leave raw line breaks inside long text fields (notably calendar data).
  // A new record only starts at a marker line; anything else continues the previous record.
  const records: string[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^(%T|%F|%R)\t/.test(line) || line === "%E" || line.startsWith("ERMHDR\t")) records.push(line);
    else if (records.length && line !== "") records[records.length - 1] += "\n" + line;
  }
  const file: XerFile = { header: [], tables: {} };
  let cur: XerTable | null = null;
  for (const rec of records) {
    const parts = rec.split("\t");
    switch (parts[0]) {
      case "ERMHDR": file.header = parts; break;
      case "%T": cur = { name: parts[1] ?? "", fields: [], rows: [] }; file.tables[cur.name] = cur; break;
      case "%F": if (cur) cur.fields = parts.slice(1); break;
      case "%R":
        if (cur) {
          const row: Record<string, string> = {};
          cur.fields.forEach((f, i) => { row[f] = parts[i + 1] ?? ""; });
          cur.rows.push(row);
        }
        break;
      case "%E": cur = null; break;
    }
  }
  return file;
}

export function isXer(text: string): boolean {
  return /^\uFEFF?ERMHDR\t/.test(text);
}

// ----------------------------------------------------------------------------- helpers

const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
};

/** XER date (`2026-11-11 08:00`, or anything Date understands) → ISO date or null. */
export function xerDateToIso(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const isoToXerDate = (iso: string | null | undefined, time: string): string => (iso ? `${iso.slice(0, 10)} ${time}` : "");

const EXCEL_EPOCH = 25569; // Excel serial of 1970-01-01
const serialToIso = (serial: number) => dayToIso(Math.round(serial) - EXCEL_EPOCH);
const isoToSerial = (iso: string) => isoToDay(iso) + EXCEL_EPOCH;

// ----------------------------------------------------------------------------- calendar data

interface CalNode { label: string; attrs: string; kids: CalNode[] }

function parseCalNodes(s: string, start: number): [CalNode[], number] {
  const nodes: CalNode[] = [];
  let i = start;
  while (i < s.length && s[i] === "(") {
    i++; // (
    const lblEnd = s.indexOf("(", i);
    if (lblEnd < 0) break;
    const label = s.slice(i, lblEnd).split("||").pop() ?? "";
    i = lblEnd + 1;
    const attrEnd = s.indexOf(")", i);
    if (attrEnd < 0) break;
    const attrs = s.slice(i, attrEnd);
    i = attrEnd + 1;
    let kids: CalNode[] = [];
    if (s[i] === "(") {
      [kids, i] = parseCalNodes(s, i + 1);
      if (s[i] === ")") i++;
    }
    if (s[i] === ")") i++;
    nodes.push({ label, attrs, kids });
  }
  return [nodes, i];
}

export interface ParsedCalendarData { workDays: boolean[]; holidays: string[]; workExceptions: string[]; hoursPerDay: number | null }

export function parseCalendarData(raw: string): ParsedCalendarData | null {
  const s = raw.replace(/[\s\x7f]/g, "");
  if (!s.includes("DaysOfWeek")) return null;
  const [roots] = parseCalNodes(s, 0);
  const find = (nodes: CalNode[], label: string): CalNode | undefined => {
    for (const n of nodes) {
      if (n.label === label) return n;
      const deep = find(n.kids, label);
      if (deep) return deep;
    }
    return undefined;
  };
  const dow = find(roots, "DaysOfWeek");
  if (!dow) return null;
  const workDays = [false, false, false, false, false, false, false]; // index 0 = Sunday; P6 day 1 = Sunday
  let hours: number | null = null;
  for (const d of dow.kids) {
    const idx = parseInt(d.label, 10) - 1;
    if (idx < 0 || idx > 6) continue;
    if (d.kids.length > 0) {
      workDays[idx] = true;
      let h = 0;
      for (const shift of d.kids) {
        const m = shift.attrs.match(/s\|(\d+):(\d+)\|f\|(\d+):(\d+)/);
        if (m) h += (+m[3] + +m[4] / 60) - (+m[1] + +m[2] / 60);
      }
      if (h > 0 && hours == null) hours = h;
    }
  }
  const holidays: string[] = [];
  const workExceptions: string[] = [];
  const exc = find(roots, "Exceptions");
  for (const e of exc?.kids ?? []) {
    const m = e.attrs.match(/d\|(\d+)/);
    if (!m) continue;
    (e.kids.length > 0 ? workExceptions : holidays).push(serialToIso(+m[1]));
  }
  return { workDays, holidays, workExceptions, hoursPerDay: hours };
}

export function buildCalendarData(workDays: boolean[], holidays: string[], workExceptions: string[], hoursPerDay: number): string {
  const start = 8 * 60;
  const end = start + Math.round(hoursPerDay * 60);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const shift = `(0||0(s|${hhmm(start)}|f|${hhmm(end)})())`;
  const days = Array.from({ length: 7 }, (_, i) => (workDays[i] ? `(0||${i + 1}()(${shift}))` : `(0||${i + 1}()())`)).join("");
  const exc = [
    ...holidays.map((h, i) => `(0||${i}(d|${isoToSerial(h)})())`),
    ...workExceptions.map((h, i) => `(0||${holidays.length + i}(d|${isoToSerial(h)})(${shift}))`),
  ].join("");
  return `(0||CalendarData()((0||DaysOfWeek()(${days}))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(${exc}))))`;
}

// ----------------------------------------------------------------------------- import model

export interface ImportedCalendar {
  p6Id: string; name: string; workDays: boolean[]; holidays: string[]; workExceptions: string[]; hoursPerDay: number;
}
export interface ImportedWbs { p6Id: string; parentP6Id: string | null; code: string; name: string; sortOrder: number }
export interface ImportedActivity {
  p6Id: string; wbsP6Id: string | null; calendarP6Id: string | null; code: string; name: string; type: ActivityType;
  durationDays: number; remainingDays: number | null; percentComplete: number;
  actualStart: string | null; actualFinish: string | null;
  plannedStart: string | null; plannedFinish: string | null;
  constraintType: string | null; constraintDate: string | null;
  sortOrder: number; raw: Record<string, string>;
}
export interface ImportedRel { predP6Id: string; succP6Id: string; type: RelType; lagDays: number }
export interface ImportedSchedule {
  name: string; code: string; p6ProjectId: string; startDate: string | null; dataDate: string | null;
  defaultCalendarP6Id: string | null;
  calendars: ImportedCalendar[]; wbs: ImportedWbs[]; activities: ImportedActivity[]; relationships: ImportedRel[];
  warnings: string[];
  /** All projects found in the file (the first one is imported unless `projectId` is given). */
  projects: { id: string; name: string; code: string }[];
}

const CSTR_IN: Record<string, string> = { CS_MSOA: "SNET", CS_MSOB: "SNLT", CS_MEOA: "FNET", CS_MEOB: "FNLT" };
const CSTR_OUT: Record<string, string> = { SNET: "CS_MSOA", SNLT: "CS_MSOB", FNET: "CS_MEOA", FNLT: "CS_MEOB" };
const REL_IN: Record<string, RelType> = { PR_FS: "FS", PR_SS: "SS", PR_FF: "FF", PR_SF: "SF" };

export function xerToSchedule(file: XerFile, opts: { projectId?: string } = {}): ImportedSchedule {
  const T = (n: string) => file.tables[n]?.rows ?? [];
  const warnings: string[] = [];

  const projRows = T("PROJECT");
  const projects = projRows.map((p) => ({ id: p.proj_id, name: p.proj_short_name || p.proj_name || `Project ${p.proj_id}`, code: p.proj_short_name || p.proj_id }));
  const proj = projRows.find((p) => p.proj_id === opts.projectId) ?? projRows[0];
  if (!proj) throw new Error("No PROJECT table found — this does not look like a P6 XER export.");
  if (projRows.length > 1 && !opts.projectId) warnings.push(`The file contains ${projRows.length} projects — imported "${projects[0].name}". Pick another one to import a different project.`);
  const projId = proj.proj_id;

  // Calendars (global + project calendars).
  const calendars: ImportedCalendar[] = T("CALENDAR").map((c) => {
    const parsed = parseCalendarData(c.clndr_data ?? "");
    if (!parsed) warnings.push(`Calendar "${c.clndr_name}": could not read its work-week — assumed Sun–Thu.`);
    return {
      p6Id: c.clndr_id,
      name: c.clndr_name || `Calendar ${c.clndr_id}`,
      workDays: parsed?.workDays.some(Boolean) ? parsed.workDays : DEFAULT_WORK_DAYS,
      holidays: parsed?.holidays ?? [],
      workExceptions: parsed?.workExceptions ?? [],
      hoursPerDay: num(c.day_hr_cnt) || parsed?.hoursPerDay || 8,
    };
  });
  const calById = new Map(calendars.map((c) => [c.p6Id, c]));
  const defaultCalendarP6Id = proj.clndr_id && calById.has(proj.clndr_id) ? proj.clndr_id : calendars[0]?.p6Id ?? null;
  const hoursFor = (calId: string | undefined) => calById.get(calId ?? "")?.hoursPerDay ?? calById.get(defaultCalendarP6Id ?? "")?.hoursPerDay ?? 8;

  // WBS — the root node (proj_node_flag = Y) is the project itself, so its children become top level.
  const wbsRows = T("PROJWBS").filter((w) => w.proj_id === projId);
  const rootIds = new Set(wbsRows.filter((w) => w.proj_node_flag === "Y").map((w) => w.wbs_id));
  const wbs: ImportedWbs[] = wbsRows
    .filter((w) => !rootIds.has(w.wbs_id))
    .map((w, i) => ({
      p6Id: w.wbs_id,
      parentP6Id: w.parent_wbs_id && !rootIds.has(w.parent_wbs_id) ? w.parent_wbs_id : null,
      code: w.wbs_short_name || w.wbs_id,
      name: w.wbs_name || w.wbs_short_name || w.wbs_id,
      sortOrder: num(w.seq_num, i),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const wbsIds = new Set(wbs.map((w) => w.p6Id));

  // Activities.
  const taskRows = T("TASK").filter((t) => t.proj_id === projId);
  let unsupported = 0;
  const activities: ImportedActivity[] = taskRows.map((t, i) => {
    const hrs = hoursFor(t.clndr_id);
    const status = t.status_code;
    const type: ActivityType = t.task_type === "TT_Mile" ? "MILESTONE_START" : t.task_type === "TT_FinMile" ? "MILESTONE_FINISH" : "TASK";
    if (t.task_type === "TT_LOE" || t.task_type === "TT_WBS") unsupported++;
    const durationDays = type === "TASK" ? num(t.target_drtn_hr_cnt) / hrs : 0;
    const remaining = t.remain_drtn_hr_cnt !== "" && t.remain_drtn_hr_cnt != null ? num(t.remain_drtn_hr_cnt) / hrs : null;
    let pct = 0;
    if (status === "TK_Complete") pct = 100;
    else if (status === "TK_Active") {
      if (t.complete_pct_type === "CP_Phys") pct = num(t.phys_complete_pct);
      else if (durationDays > 0 && remaining != null) pct = Math.max(0, Math.min(100, (1 - remaining / durationDays) * 100));
    }
    const wbsId = t.wbs_id && wbsIds.has(t.wbs_id) ? t.wbs_id : null;
    return {
      p6Id: t.task_id,
      wbsP6Id: wbsId,
      calendarP6Id: t.clndr_id && calById.has(t.clndr_id) ? t.clndr_id : null,
      code: t.task_code || t.task_id,
      name: t.task_name || t.task_code || t.task_id,
      type,
      durationDays: Math.round(durationDays * 1000) / 1000,
      remainingDays: remaining == null ? null : Math.round(remaining * 1000) / 1000,
      percentComplete: Math.round(pct * 100) / 100,
      actualStart: xerDateToIso(t.act_start_date),
      actualFinish: status === "TK_Complete" || t.act_end_date ? xerDateToIso(t.act_end_date) : null,
      plannedStart: xerDateToIso(t.early_start_date || t.restart_date || t.target_start_date),
      plannedFinish: xerDateToIso(t.early_end_date || t.reend_date || t.target_end_date),
      constraintType: CSTR_IN[t.cstr_type] ?? null,
      constraintDate: CSTR_IN[t.cstr_type] ? xerDateToIso(t.cstr_date) : null,
      sortOrder: i,
      raw: t,
    };
  });
  if (unsupported) warnings.push(`${unsupported} Level-of-Effort / WBS-summary activities were imported as normal tasks.`);
  const taskIds = new Set(activities.map((a) => a.p6Id));

  // Relationships.
  const relationships: ImportedRel[] = [];
  let outside = 0;
  for (const r of T("TASKPRED")) {
    if (!taskIds.has(r.task_id) || !taskIds.has(r.pred_task_id)) {
      if (r.proj_id === projId || r.pred_proj_id === projId) outside++;
      continue;
    }
    const succ = activities.find((a) => a.p6Id === r.task_id)!;
    relationships.push({
      predP6Id: r.pred_task_id,
      succP6Id: r.task_id,
      type: REL_IN[r.pred_type] ?? "FS",
      lagDays: num(r.lag_hr_cnt) / hoursFor(succ.calendarP6Id ?? undefined),
    });
  }
  if (outside) warnings.push(`${outside} links to activities in other projects were skipped.`);

  const starts = activities.map((a) => a.plannedStart).filter(Boolean) as string[];
  return {
    name: proj.proj_short_name || proj.proj_name || "Imported schedule",
    code: proj.proj_short_name || projId,
    p6ProjectId: projId,
    startDate: xerDateToIso(proj.plan_start_date) ?? (starts.length ? starts.sort()[0] : null),
    dataDate: xerDateToIso(proj.last_recalc_date),
    defaultCalendarP6Id,
    calendars, wbs, activities, relationships, warnings, projects,
  };
}

// ----------------------------------------------------------------------------- export

export interface ExportCalendar { id: string; p6Id: string | null; name: string; workDays: boolean[]; holidays: string[]; workExceptions: string[]; hoursPerDay: number; isDefault: boolean }
export interface ExportWbs { id: string; p6Id: string | null; parentId: string | null; code: string; name: string; sortOrder: number }
export interface ExportActivity {
  id: string; p6Id: string | null; wbsId: string | null; calendarId: string | null; code: string; name: string; type: ActivityType;
  durationDays: number; remainingDays: number | null; percentComplete: number;
  actualStart: string | null; actualFinish: string | null; earlyStart: string | null; earlyFinish: string | null;
  lateStart: string | null; lateFinish: string | null; totalFloat: number | null;
  constraintType: string | null; constraintDate: string | null; raw: Record<string, string> | null;
}
export interface ExportRel { predecessorId: string; successorId: string; type: RelType; lagDays: number }
export interface ExportSchedule {
  name: string; code: string; startDate: string; dataDate: string; finishDate: string | null;
  calendars: ExportCalendar[]; wbs: ExportWbs[]; activities: ExportActivity[]; relationships: ExportRel[];
}

/** Hand out numeric ids: keep numeric p6Ids that were imported, assign fresh ones above the maximum otherwise. */
function assignIds<T extends { id: string; p6Id: string | null }>(items: T[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const it of items) {
    if (it.p6Id && /^\d+$/.test(it.p6Id) && !used.has(it.p6Id)) { map.set(it.id, it.p6Id); used.add(it.p6Id); }
  }
  let next = Math.max(1000, ...[...used].map(Number)) + 1;
  for (const it of items) if (!map.has(it.id)) { map.set(it.id, String(next++)); }
  return map;
}

const clean = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function writeXer(s: ExportSchedule): string {
  const out: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const table = (name: string, fields: string[], rows: (string | number)[][]) => {
    out.push(`%T\t${name}`, `%F\t${fields.join("\t")}`);
    for (const r of rows) out.push(`%R\t${r.map(clean).join("\t")}`);
  };

  out.push(["ERMHDR", "19.12", today, "Project", "admin", "admin", "SteelFlow", "Project Management", "USD"].join("\t"));

  table("CURRTYPE",
    ["curr_id", "decimal_digit_cnt", "curr_symbol", "decimal_symbol", "digit_group_symbol", "pos_curr_fmt_type", "neg_curr_fmt_type", "curr_type", "curr_short_name", "group_digit_cnt", "base_exch_rate"],
    [["1", "2", "$", ".", ",", "#1.1", "(#1.1)", "US Dollar", "USD", "3", "1"]]);

  const calIds = assignIds(s.calendars);
  const wbsIds = assignIds(s.wbs);
  const taskIds = assignIds(s.activities);
  const defCal = s.calendars.find((c) => c.isDefault) ?? s.calendars[0];
  const projId = "1";
  const rootWbsId = String(Math.max(...[...wbsIds.values()].map(Number), 1000) + 1);

  table("PROJECT",
    ["proj_id", "fy_start_month_num", "def_complete_pct_type", "def_duration_type", "def_task_type", "project_flag", "name_sep_char", "proj_short_name", "clndr_id", "task_code_prefix", "task_code_base", "task_code_step", "critical_path_type", "plan_start_date", "scd_end_date", "last_recalc_date", "add_date"],
    [[projId, "1", "CP_Drtn", "DT_FixedDUR2", "TT_Task", "Y", ".", s.code, defCal ? calIds.get(defCal.id)! : "", "A", "1000", "10", "CT_TotFloat",
      isoToXerDate(s.startDate, "08:00"), isoToXerDate(s.finishDate, "16:00"), isoToXerDate(s.dataDate, "08:00"), isoToXerDate(today, "08:00")]]);

  table("CALENDAR",
    ["clndr_id", "default_flag", "clndr_name", "proj_id", "base_clndr_id", "last_chng_date", "clndr_type", "day_hr_cnt", "week_hr_cnt", "month_hr_cnt", "year_hr_cnt", "rsrc_private", "clndr_data"],
    s.calendars.map((c) => {
      const days = c.workDays.filter(Boolean).length;
      return [calIds.get(c.id)!, c.isDefault ? "Y" : "N", c.name, projId, "", isoToXerDate(today, "08:00"), "CA_Project",
        fmt(c.hoursPerDay), fmt(c.hoursPerDay * days), fmt((c.hoursPerDay * days * 52) / 12), fmt(c.hoursPerDay * days * 52), "N",
        buildCalendarData(c.workDays, c.holidays, c.workExceptions, c.hoursPerDay)];
    }));

  // WBS: a root node for the project, then our hierarchy beneath it.
  const wbsRows: (string | number)[][] = [[rootWbsId, projId, "0", "Y", s.code, s.name, ""]];
  const sortedWbs = [...s.wbs].sort((a, b) => a.sortOrder - b.sortOrder);
  sortedWbs.forEach((w, i) => {
    wbsRows.push([wbsIds.get(w.id)!, projId, String((i + 1) * 10), "N", w.code, w.name, w.parentId ? wbsIds.get(w.parentId) ?? rootWbsId : rootWbsId]);
  });
  table("PROJWBS", ["wbs_id", "proj_id", "seq_num", "proj_node_flag", "wbs_short_name", "wbs_name", "parent_wbs_id"], wbsRows);

  // Tasks: our managed columns first, then any extra columns that came in with an earlier import.
  const calById = new Map(s.calendars.map((c) => [c.id, c]));
  const managed = [
    "task_id", "proj_id", "wbs_id", "clndr_id", "task_type", "duration_type", "complete_pct_type", "status_code", "task_code", "task_name",
    "phys_complete_pct", "total_float_hr_cnt", "remain_drtn_hr_cnt", "target_drtn_hr_cnt",
    "act_start_date", "act_end_date", "early_start_date", "early_end_date", "late_start_date", "late_end_date",
    "target_start_date", "target_end_date", "restart_date", "reend_date", "cstr_type", "cstr_date",
  ];
  const extras: string[] = [];
  for (const a of s.activities) for (const k of Object.keys(a.raw ?? {})) if (!managed.includes(k) && !extras.includes(k)) extras.push(k);
  const fields = [...managed, ...extras];
  const wbsFallback = sortedWbs.length ? wbsIds.get(sortedWbs[0].id)! : rootWbsId;

  const taskRows = s.activities.map((a) => {
    const cal = (a.calendarId ? calById.get(a.calendarId) : undefined) ?? defCal;
    const hrs = cal?.hoursPerDay ?? 8;
    const finishTime = `${String(8 + Math.round(hrs)).padStart(2, "0")}:00`;
    const complete = a.actualFinish != null || a.percentComplete >= 100;
    const active = !complete && a.actualStart != null;
    const status = complete ? "TK_Complete" : active ? "TK_Active" : "TK_NotStart";
    const remaining = complete ? 0 : a.remainingDays ?? (a.type === "TASK" ? a.durationDays * (1 - a.percentComplete / 100) : 0);
    const cstr = a.constraintType ? CSTR_OUT[a.constraintType] : undefined;
    const isMile = a.type !== "TASK";
    const row: Record<string, string> = {
      ...(a.raw ?? {}),
      task_id: taskIds.get(a.id)!,
      proj_id: projId,
      wbs_id: a.wbsId ? wbsIds.get(a.wbsId) ?? wbsFallback : wbsFallback,
      clndr_id: cal ? calIds.get(cal.id)! : "",
      task_type: a.type === "MILESTONE_START" ? "TT_Mile" : a.type === "MILESTONE_FINISH" ? "TT_FinMile" : a.raw?.task_type === "TT_LOE" ? "TT_LOE" : "TT_Task",
      duration_type: a.raw?.duration_type || "DT_FixedDUR2",
      complete_pct_type: a.raw?.complete_pct_type || "CP_Drtn",
      status_code: status,
      task_code: a.code,
      task_name: a.name,
      phys_complete_pct: fmt(a.percentComplete),
      total_float_hr_cnt: a.totalFloat == null ? "" : fmt(a.totalFloat * hrs),
      remain_drtn_hr_cnt: fmt(remaining * hrs),
      target_drtn_hr_cnt: fmt(isMile ? 0 : a.durationDays * hrs),
      act_start_date: isoToXerDate(a.actualStart, "08:00"),
      act_end_date: complete ? isoToXerDate(a.actualFinish ?? a.earlyFinish, finishTime) : "",
      early_start_date: complete ? "" : isoToXerDate(a.earlyStart, "08:00"),
      early_end_date: complete ? "" : isoToXerDate(a.earlyFinish, finishTime),
      late_start_date: isoToXerDate(a.lateStart, "08:00"),
      late_end_date: isoToXerDate(a.lateFinish, finishTime),
      target_start_date: isoToXerDate(a.earlyStart, "08:00"),
      target_end_date: isoToXerDate(a.earlyFinish, finishTime),
      restart_date: active ? isoToXerDate(a.earlyFinish ? a.earlyStart : null, "08:00") : "",
      reend_date: active ? isoToXerDate(a.earlyFinish, finishTime) : "",
      cstr_type: cstr ?? a.raw?.cstr_type ?? "",
      cstr_date: cstr ? isoToXerDate(a.constraintDate, "08:00") : a.raw?.cstr_date ?? "",
    };
    return fields.map((f) => row[f] ?? "");
  });
  table("TASK", fields, taskRows);

  const REL_OUT: Record<RelType, string> = { FS: "PR_FS", SS: "PR_SS", FF: "PR_FF", SF: "PR_SF" };
  const actById = new Map(s.activities.map((a) => [a.id, a]));
  let predId = 1000;
  table("TASKPRED",
    ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt"],
    s.relationships
      .filter((r) => taskIds.has(r.predecessorId) && taskIds.has(r.successorId))
      .map((r) => {
        const succ = actById.get(r.successorId)!;
        const hrs = ((succ.calendarId ? calById.get(succ.calendarId) : undefined) ?? defCal)?.hoursPerDay ?? 8;
        return [String(++predId), taskIds.get(r.successorId)!, taskIds.get(r.predecessorId)!, projId, projId, REL_OUT[r.type], fmt(r.lagDays * hrs)];
      }));

  out.push("%E");
  return out.join("\r\n") + "\r\n";
}
