// Dashboard maths for the planning module: progress, S-curve, SPI, delay, alerts,
// WBS roll-up and the flattened rows used by the Gantt / table views.
// Pure functions — they only read plain data so they are easy to test.

import { DEFAULT_WORK_DAYS, WorkCalendar, dayToIso, isoToDay } from "./calendar";
import type { ActivityType, CalendarDef } from "./types";

export interface MetricActivity {
  id: string;
  wbsId: string | null;
  code: string;
  name: string;
  type: ActivityType;
  calendarId: string | null;
  durationDays: number;
  remainingDays: number;
  percentComplete: number;
  actualStart: string | null;
  actualFinish: string | null;
  earlyStart: string;
  earlyFinish: string;
  totalFloat: number;
  isCritical: boolean;
}
export interface MetricWbs { id: string; parentId: string | null; code: string; name: string; sortOrder: number }
export interface BaselineItem { start: string; finish: string }
export type BaselineMap = Record<string, BaselineItem>;
export interface Snapshot { dataDate: string; percent: number }

export interface MetricInput {
  activities: MetricActivity[];
  wbs: MetricWbs[];
  calendars: CalendarDef[];
  defaultCalendarId: string;
  dataDate: string;
  baseline: BaselineMap | null;
  snapshots: Snapshot[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isDone = (a: MetricActivity) => a.actualFinish != null || a.percentComplete >= 100;
const pctOf = (a: MetricActivity) => (isDone(a) ? 100 : clamp(a.percentComplete, 0, 100));
const weightOf = (a: MetricActivity) => (a.type === "TASK" ? Math.max(0, a.durationDays) : 0);

/** Duration-weighted progress of a set of activities (0–100). Milestones carry no weight. */
export function weightedProgress(acts: MetricActivity[]): number {
  const tasks = acts.filter((a) => weightOf(a) > 0);
  if (tasks.length === 0) {
    const m = acts.filter((a) => a.type !== "TASK");
    return m.length ? (m.reduce((s, a) => s + pctOf(a), 0) / m.length) : 0;
  }
  const total = tasks.reduce((s, a) => s + weightOf(a), 0);
  return tasks.reduce((s, a) => s + weightOf(a) * pctOf(a), 0) / total;
}

function calendarGetter(input: Pick<MetricInput, "calendars" | "defaultCalendarId">) {
  const map = new Map(input.calendars.map((c) => [c.id, new WorkCalendar(c)]));
  const def = map.get(input.defaultCalendarId) ?? new WorkCalendar({ workDays: DEFAULT_WORK_DAYS, holidays: [], workExceptions: [], hoursPerDay: 8 });
  return (id: string | null) => (id ? map.get(id) : undefined) ?? def;
}

/**
 * Planned % complete at the end of `day`, assuming each task progresses evenly over its
 * working days. `source` picks the dates: the current schedule or the baseline.
 */
export function plannedPercentAt(input: MetricInput, day: number, source: "plan" | "baseline"): number {
  const calOf = calendarGetter(input);
  const tasks = input.activities.filter((a) => weightOf(a) > 0);
  if (tasks.length === 0) return 0;
  let total = 0;
  let earned = 0;
  for (const a of tasks) {
    const b = source === "baseline" ? input.baseline?.[a.id] : null;
    if (source === "baseline" && !b) continue;
    const s = isoToDay(b ? b.start : a.earlyStart);
    const f = isoToDay(b ? b.finish : a.earlyFinish);
    const w = weightOf(a);
    total += w;
    if (day < s) continue;
    if (day >= f) { earned += w; continue; }
    const cal = calOf(a.calendarId);
    const all = cal.workDaysBetween(s, f) + 1;
    const done = cal.workDaysBetween(s, day) + 1;
    earned += w * clamp(done / Math.max(1, all), 0, 1);
  }
  return total > 0 ? (earned / total) * 100 : 0;
}

export interface CurvePoint { day: number; plan: number; baseline: number | null }
export interface SCurve {
  points: CurvePoint[];
  actual: { day: number; value: number }[];
  dataDay: number;
}

/** S-curve sampled at month starts (or weeks for short schedules), plus start, finish and the data date. */
export function buildSCurve(input: MetricInput): SCurve {
  const acts = input.activities;
  const dataDay = isoToDay(input.dataDate);
  if (acts.length === 0) return { points: [], actual: [], dataDay };
  const starts = acts.map((a) => isoToDay(a.earlyStart));
  const finishes = acts.map((a) => isoToDay(a.earlyFinish));
  if (input.baseline) for (const b of Object.values(input.baseline)) { starts.push(isoToDay(b.start)); finishes.push(isoToDay(b.finish)); }
  const first = Math.min(...starts);
  const last = Math.max(...finishes);

  const days = new Set<number>([first - 1, last, dataDay]);
  const weekly = last - first <= 120;
  const startMonth = new Date(first * 86_400_000);
  for (let d = weekly ? first : isoToDay(new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)); d <= last; ) {
    days.add(d);
    if (weekly) d += 7;
    else { const dt = new Date(d * 86_400_000); d = isoToDay(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)); }
  }
  const points = [...days].sort((a, b) => a - b).map((day) => ({
    day,
    plan: round1(plannedPercentAt(input, day, "plan")),
    baseline: input.baseline ? round1(plannedPercentAt(input, day, "baseline")) : null,
  }));

  const hist = [...input.snapshots]
    .map((s) => ({ day: isoToDay(s.dataDate), value: round1(s.percent) }))
    .filter((s) => s.day < dataDay)
    .sort((a, b) => a.day - b.day);
  const actual = [{ day: first - 1, value: 0 }, ...hist, { day: dataDay, value: round1(weightedProgress(acts)) }];
  return { points, actual, dataDay };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

// ------------------------------------------------------------------------------ KPIs

export interface Kpis {
  progress: number;
  plannedPercent: number;
  spi: number | null;
  plannedFinish: string | null;
  currentFinish: string | null;
  actualFinish: string | null;
  delayDays: number;
  hasBaseline: boolean;
  totalActivities: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  criticalCount: number;
  minFloat: number | null;
}

export function computeKpis(input: MetricInput): Kpis {
  const acts = input.activities;
  const dataDay = isoToDay(input.dataDate);
  const hasBaseline = !!input.baseline && Object.keys(input.baseline).length > 0;
  const progress = weightedProgress(acts);
  const planned = plannedPercentAt(input, dataDay, hasBaseline ? "baseline" : "plan");
  const finishes = acts.map((a) => a.earlyFinish).sort();
  const currentFinish = finishes.length ? finishes[finishes.length - 1] : null;
  const blFinishes = hasBaseline ? Object.values(input.baseline!).map((b) => b.finish).sort() : [];
  const baselineFinish = blFinishes.length ? blFinishes[blFinishes.length - 1] : null;
  const allDone = acts.length > 0 && acts.every(isDone);
  const open = acts.filter((a) => !isDone(a));
  return {
    progress: round1(progress),
    plannedPercent: round1(planned),
    spi: planned > 0.5 ? Math.round((progress / planned) * 100) / 100 : null,
    plannedFinish: baselineFinish ?? currentFinish,
    currentFinish,
    actualFinish: allDone ? acts.map((a) => a.actualFinish ?? a.earlyFinish).sort().pop() ?? null : null,
    delayDays: baselineFinish && currentFinish ? isoToDay(currentFinish) - isoToDay(baselineFinish) : 0,
    hasBaseline,
    totalActivities: acts.length,
    notStarted: acts.filter((a) => !isDone(a) && !a.actualStart).length,
    inProgress: acts.filter((a) => !isDone(a) && a.actualStart).length,
    completed: acts.filter(isDone).length,
    criticalCount: acts.filter((a) => a.isCritical).length,
    minFloat: open.length ? Math.min(...open.map((a) => a.totalFloat)) : null,
  };
}

// ------------------------------------------------------------------------- WBS roll-up

export interface WbsProgress { id: string; code: string; name: string; progress: number; activityCount: number }

/** Progress of each top-level WBS element (including everything beneath it). */
export function wbsProgress(input: Pick<MetricInput, "wbs" | "activities">): WbsProgress[] {
  const children = new Map<string | null, MetricWbs[]>();
  for (const w of input.wbs) (children.get(w.parentId) ?? children.set(w.parentId, []).get(w.parentId)!).push(w);
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (const c of children.get(id) ?? []) for (const d of descendants(c.id)) out.add(d);
    return out;
  };
  return (children.get(null) ?? [])
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((w) => {
      const ids = descendants(w.id);
      const acts = input.activities.filter((a) => a.wbsId && ids.has(a.wbsId));
      return { id: w.id, code: w.code, name: w.name, progress: Math.round(weightedProgress(acts)), activityCount: acts.length };
    });
}

// ----------------------------------------------------------------------- alerts / milestones

export interface Alert { id: string; kind: "DELAYED" | "AT_RISK" | "COMPLETED"; name: string; code: string; date: string; note: string }

export function buildAlerts(input: MetricInput, limit = 6): Alert[] {
  const dataDay = isoToDay(input.dataDate);
  const delayed: (Alert & { sort: number })[] = [];
  const atRisk: (Alert & { sort: number })[] = [];
  const done: (Alert & { sort: number })[] = [];
  for (const a of input.activities) {
    if (a.type !== "TASK") continue;
    if (isDone(a)) {
      if (a.actualFinish) done.push({ id: a.id, kind: "COMPLETED", name: a.name, code: a.code, date: a.actualFinish, note: "Completed", sort: -isoToDay(a.actualFinish) });
      continue;
    }
    const bl = input.baseline?.[a.id];
    const late = bl ? Math.max(isoToDay(a.earlyFinish) - isoToDay(bl.finish), isoToDay(bl.finish) < dataDay ? dataDay - isoToDay(bl.finish) : 0) : 0;
    if (late > 0) {
      delayed.push({ id: a.id, kind: "DELAYED", name: a.name, code: a.code, date: a.earlyFinish, note: `+${late} day${late === 1 ? "" : "s"} behind baseline`, sort: -late });
    } else if (a.totalFloat <= 5 && isoToDay(a.earlyStart) <= dataDay + 14) {
      atRisk.push({ id: a.id, kind: "AT_RISK", name: a.name, code: a.code, date: a.earlyFinish, note: a.totalFloat <= 0 ? "Critical — no float" : `Only ${a.totalFloat} day${a.totalFloat === 1 ? "" : "s"} of float`, sort: a.totalFloat });
    }
  }
  const by = (x: { sort: number }, y: { sort: number }) => x.sort - y.sort;
  return [...delayed.sort(by).slice(0, 3), ...atRisk.sort(by).slice(0, 2), ...done.sort(by).slice(0, 1)].slice(0, limit).map((a) => ({ id: a.id, kind: a.kind, name: a.name, code: a.code, date: a.date, note: a.note }));
}

export interface MilestoneRow { id: string; name: string; date: string; status: "DONE" | "NEXT" | "UPCOMING" }

export function buildMilestones(input: Pick<MetricInput, "activities">, limit = 5): MilestoneRow[] {
  const ms = input.activities.filter((a) => a.type !== "TASK").sort((a, b) => (a.actualFinish ?? a.earlyFinish).localeCompare(b.actualFinish ?? b.earlyFinish));
  const done = ms.filter(isDone);
  const open = ms.filter((a) => !isDone(a));
  const rows: MilestoneRow[] = [
    ...done.slice(-2).map((a) => ({ id: a.id, name: a.name, date: a.actualFinish ?? a.earlyFinish, status: "DONE" as const })),
    ...open.map((a, i) => ({ id: a.id, name: a.name, date: a.earlyFinish, status: i === 0 ? ("NEXT" as const) : ("UPCOMING" as const) })),
  ];
  return rows.slice(0, limit);
}

// ----------------------------------------------------------------------------- table rows

export interface PlanRow {
  key: string;
  kind: "wbs" | "activity";
  id: string;
  level: number;
  outline: string;
  code: string;
  name: string;
  type: ActivityType | null;
  duration: number;
  start: string;
  finish: string;
  percent: number;
  float: number;
  critical: boolean;
  baselineStart: string | null;
  baselineFinish: string | null;
  actualStart: string | null;
  done: boolean;
  hasChildren: boolean;
  parentKey: string | null;
}

/** Flatten WBS tree + activities into display rows with outline numbers and summary roll-ups. */
export function buildRows(input: Pick<MetricInput, "wbs" | "activities" | "baseline" | "calendars" | "defaultCalendarId">, activityOrder: Map<string, number>): PlanRow[] {
  const calOf = calendarGetter(input);
  const wbsKids = new Map<string | null, MetricWbs[]>();
  for (const w of input.wbs) (wbsKids.get(w.parentId) ?? wbsKids.set(w.parentId, []).get(w.parentId)!).push(w);
  const actsByWbs = new Map<string | null, MetricActivity[]>();
  for (const a of input.activities) (actsByWbs.get(a.wbsId) ?? actsByWbs.set(a.wbsId, []).get(a.wbsId)!).push(a);
  const ord = (a: MetricActivity) => activityOrder.get(a.id) ?? 0;

  const rows: PlanRow[] = [];
  const emitActivity = (a: MetricActivity, level: number, outline: string, parentKey: string | null) => {
    const bl = input.baseline?.[a.id];
    rows.push({
      key: `a:${a.id}`, kind: "activity", id: a.id, level, outline, code: a.code, name: a.name, type: a.type,
      duration: a.type === "TASK" ? a.durationDays : 0, start: a.actualStart ?? a.earlyStart, finish: a.actualFinish ?? a.earlyFinish,
      percent: Math.round(pctOf(a)), float: a.totalFloat, critical: a.isCritical, baselineStart: bl?.start ?? null, baselineFinish: bl?.finish ?? null,
      actualStart: a.actualStart, done: isDone(a), hasChildren: false, parentKey,
    });
  };
  const walk = (parent: MetricWbs | null, level: number, prefix: string, parentKey: string | null) => {
    const kids = (wbsKids.get(parent?.id ?? null) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    const own = (actsByWbs.get(parent?.id ?? null) ?? []).sort((a, b) => ord(a) - ord(b));
    let n = 0;
    for (const w of kids) {
      n++;
      const outline = prefix ? `${prefix}.${n}` : String(n);
      const key = `w:${w.id}`;
      const idx = rows.length;
      rows.push({ key, kind: "wbs", id: w.id, level, outline, code: w.code, name: w.name, type: null, duration: 0, start: "", finish: "", percent: 0, float: 0, critical: false, baselineStart: null, baselineFinish: null, actualStart: null, done: false, hasChildren: true, parentKey });
      walk(w, level + 1, outline, key);
      // Roll-up from the rows just emitted beneath this WBS.
      const leaves = rows.slice(idx + 1).filter((r) => r.kind === "activity");
      const row = rows[idx];
      if (leaves.length === 0) { row.hasChildren = false; continue; }
      row.start = leaves.map((r) => r.start).sort()[0];
      row.finish = leaves.map((r) => r.finish).sort().pop()!;
      const blS = leaves.map((r) => r.baselineStart).filter(Boolean) as string[];
      const blF = leaves.map((r) => r.baselineFinish).filter(Boolean) as string[];
      row.baselineStart = blS.length ? blS.sort()[0] : null;
      row.baselineFinish = blF.length ? blF.sort().pop()! : null;
      row.duration = calOf(null).workDaysBetween(isoToDay(row.start), isoToDay(row.finish)) + 1;
      const ids = new Set(leaves.map((r) => r.id));
      row.percent = Math.round(weightedProgress(input.activities.filter((a) => ids.has(a.id))));
      row.float = Math.min(...leaves.map((r) => r.float));
      row.critical = leaves.some((r) => r.critical);
      row.done = leaves.every((r) => r.done);
    }
    for (const a of own) {
      n++;
      emitActivity(a, level, prefix ? `${prefix}.${n}` : String(n), parentKey);
    }
  };
  walk(null, 0, "", null);
  // Activities whose WBS is missing from the tree still need to show up.
  const shown = new Set(rows.filter((r) => r.kind === "activity").map((r) => r.id));
  for (const a of input.activities) if (!shown.has(a.id)) emitActivity(a, 0, String(rows.length + 1), null);
  return rows;
}

export const isoDiffDays = (a: string, b: string) => isoToDay(b) - isoToDay(a);
export { dayToIso };
