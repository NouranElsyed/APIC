// Planning & follow-up service: schedule CRUD, progress updates, baselines,
// CPM recalculation and Primavera (XER) import / export.
//
// Every mutation re-runs the CPM engine afterwards so stored early/late dates,
// float and the critical flag always match the logic.

import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { runCpm } from "@/features/planning/cpm";
import { DEFAULT_WORK_DAYS, dateToIso, isoToDate, isoToDay } from "@/features/planning/calendar";
import {
  buildAlerts, buildMilestones, buildRows, buildSCurve, computeKpis, wbsProgress, weightedProgress,
  type BaselineMap, type MetricActivity, type MetricInput,
} from "@/features/planning/metrics";
import { parseXer, writeXer, xerToSchedule, type ExportSchedule, type ImportedSchedule } from "@/features/planning/xer";
import { mergeRelationships, planMerge, type ActivityPatch } from "@/features/planning/merge";
import type { PlanActivityDTO, PlanningData } from "@/features/planning/dto";
import type { ActivityType, CalendarDef, RelType } from "@/features/planning/types";
import type {
  ActivityInput, CreateScheduleInput, ProgressInput, UpdateScheduleInput, WbsInput,
} from "@/server/validators/planning";

export class PlanningError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const DEFAULT_CALENDAR_NAME = "Standard (Sun–Thu)";
const STARTER_WBS = ["Engineering", "Procurement", "Fabrication", "Installation"];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const d2 = (iso: string | null | undefined) => (iso ? isoToDate(iso) : null);
const i2 = (d: Date | null | undefined) => (d ? dateToIso(d) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

async function scheduleOrThrow(projectId: string) {
  const s = await prisma.planSchedule.findUnique({ where: { projectId } });
  if (!s) throw new PlanningError("This project has no schedule yet.", 404);
  return s;
}

// ------------------------------------------------------------------ reading the schedule

type DbCalendar = { id: string; name: string; workDays: unknown; holidays: unknown; workExceptions: unknown; hoursPerDay: number; isDefault: boolean };

function toCalendarDef(c: DbCalendar): CalendarDef & { isDefault: boolean } {
  const wd = Array.isArray(c.workDays) && c.workDays.length === 7 ? (c.workDays as boolean[]) : DEFAULT_WORK_DAYS;
  return {
    id: c.id, name: c.name, workDays: wd,
    holidays: Array.isArray(c.holidays) ? (c.holidays as string[]) : [],
    workExceptions: Array.isArray(c.workExceptions) ? (c.workExceptions as string[]) : [],
    hoursPerDay: c.hoursPerDay, isDefault: c.isDefault,
  };
}

async function loadFull(projectId: string) {
  return prisma.planSchedule.findUnique({
    where: { projectId },
    include: {
      calendars: { orderBy: { createdAt: "asc" } },
      wbs: { orderBy: { sortOrder: "asc" } },
      activities: { orderBy: { sortOrder: "asc" } },
      relationships: true,
      baselines: { where: { isPrimary: true }, orderBy: { createdAt: "desc" }, take: 1 },
      snapshots: { orderBy: { dataDate: "asc" } },
    },
  });
}

export async function getPlanningData(projectId: string): Promise<PlanningData | null> {
  const s = await loadFull(projectId);
  if (!s) return null;

  const calendars = s.calendars.map(toCalendarDef);
  const defaultCalendarId = s.defaultCalendarId ?? calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? "";
  const startIso = dateToIso(s.startDate);
  const dataIso = dateToIso(s.dataDate);

  const predsByAct = new Map<string, PlanActivityDTO["predecessors"]>();
  for (const r of s.relationships) {
    const list = predsByAct.get(r.successorId) ?? [];
    list.push({ relId: r.id, activityId: r.predecessorId, type: r.type as RelType, lagDays: r.lagDays });
    predsByAct.set(r.successorId, list);
  }

  const activities: PlanActivityDTO[] = s.activities.map((a) => ({
    id: a.id,
    wbsId: a.wbsId,
    calendarId: a.calendarId,
    code: a.code,
    name: a.name,
    type: a.type as ActivityType,
    durationDays: a.durationDays,
    remainingDays: a.remainingDays ?? a.durationDays,
    percentComplete: a.percentComplete,
    actualStart: i2(a.actualStart),
    actualFinish: i2(a.actualFinish),
    constraintType: a.constraintType,
    constraintDate: i2(a.constraintDate),
    earlyStart: i2(a.earlyStart) ?? startIso,
    earlyFinish: i2(a.earlyFinish) ?? startIso,
    lateStart: i2(a.lateStart) ?? startIso,
    lateFinish: i2(a.lateFinish) ?? startIso,
    totalFloat: a.totalFloat ?? 0,
    isCritical: a.isCritical,
    predecessors: predsByAct.get(a.id) ?? [],
  }));

  const wbs = s.wbs.map((w) => ({ id: w.id, parentId: w.parentId, code: w.code, name: w.name, sortOrder: w.sortOrder }));
  const baselineRow = s.baselines[0] ?? null;
  const baseline = baselineRow ? (baselineRow.data as unknown as BaselineMap) : null;

  const metricActs: MetricActivity[] = activities.map((a) => ({
    id: a.id, wbsId: a.wbsId, code: a.code, name: a.name, type: a.type, calendarId: a.calendarId,
    durationDays: a.durationDays, remainingDays: a.remainingDays, percentComplete: a.percentComplete,
    actualStart: a.actualStart, actualFinish: a.actualFinish, earlyStart: a.earlyStart, earlyFinish: a.earlyFinish,
    totalFloat: a.totalFloat, isCritical: a.isCritical,
  }));
  const mi: MetricInput = {
    activities: metricActs, wbs, calendars, defaultCalendarId, dataDate: dataIso, baseline,
    snapshots: s.snapshots.map((x) => ({ dataDate: dateToIso(x.dataDate), percent: x.percent })),
  };
  const order = new Map(s.activities.map((a, i) => [a.id, i]));

  const criticalPath = activities
    .filter((a) => a.isCritical && a.type === "TASK")
    .sort((a, b) => a.earlyStart.localeCompare(b.earlyStart) || a.earlyFinish.localeCompare(b.earlyFinish))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, duration: a.durationDays, start: a.earlyStart, finish: a.earlyFinish }));

  return {
    schedule: {
      id: s.id, name: s.name, startDate: startIso, dataDate: dataIso, finishDate: i2(s.finishDate),
      source: s.source, calcError: s.calcError, defaultCalendarId: s.defaultCalendarId,
    },
    calendars,
    wbs,
    activities,
    baseline: baselineRow ? { id: baselineRow.id, name: baselineRow.name, createdAt: baselineRow.createdAt.toISOString() } : null,
    rows: buildRows(mi, order),
    kpis: computeKpis(mi),
    scurve: buildSCurve(mi),
    wbsProgress: wbsProgress(mi),
    alerts: buildAlerts(mi),
    milestones: buildMilestones(mi),
    criticalPath,
  };
}

// --------------------------------------------------------------------- recalculation

export async function recalculate(scheduleId: string) {
  const s = await prisma.planSchedule.findUnique({
    where: { id: scheduleId },
    include: { calendars: true, activities: true, relationships: true },
  });
  if (!s) return;
  const calendars = s.calendars.map(toCalendarDef);
  const result = runCpm({
    activities: s.activities.map((a) => ({
      id: a.id,
      type: a.type as ActivityType,
      durationDays: a.durationDays,
      remainingDays: a.remainingDays,
      percentComplete: a.percentComplete,
      actualStart: i2(a.actualStart),
      actualFinish: i2(a.actualFinish),
      calendarId: a.calendarId,
      constraintType: a.constraintType,
      constraintDate: i2(a.constraintDate),
    })),
    relationships: s.relationships.map((r) => ({ predecessorId: r.predecessorId, successorId: r.successorId, type: r.type as RelType, lagDays: r.lagDays })),
    calendars,
    defaultCalendarId: s.defaultCalendarId ?? calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? "",
    projectStart: dateToIso(s.startDate),
    dataDate: dateToIso(s.dataDate),
  });

  if (!result.ok) {
    const names = s.activities.filter((a) => result.cycleIds.includes(a.id)).map((a) => a.code).slice(0, 8).join(", ");
    await prisma.planSchedule.update({ where: { id: scheduleId }, data: { calcError: `Logic loop between: ${names}. Remove one of the links to recalculate.` } });
    return;
  }

  await prisma.$transaction([
    ...s.activities.map((a) => {
      const r = result.activities[a.id];
      return prisma.planActivity.update({
        where: { id: a.id },
        data: {
          earlyStart: d2(r.earlyStart), earlyFinish: d2(r.earlyFinish), lateStart: d2(r.lateStart), lateFinish: d2(r.lateFinish),
          totalFloat: r.totalFloat, isCritical: r.isCritical,
        },
      });
    }),
    prisma.planSchedule.update({ where: { id: scheduleId }, data: { finishDate: d2(result.projectFinish), calcError: null } }),
  ]);
}

// -------------------------------------------------------------------------- schedule

export async function createSchedule(projectId: string, input: CreateScheduleInput, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new PlanningError("Project not found", 404);
  if (await prisma.planSchedule.findUnique({ where: { projectId }, select: { id: true } })) {
    throw new PlanningError("This project already has a schedule.", 409);
  }
  const start = d2(input.startDate)!;
  const calId = randomUUID();
  const schedule = await prisma.planSchedule.create({
    data: {
      projectId, name: input.name, startDate: start, dataDate: start, defaultCalendarId: calId, createdById: userId,
      calendars: { create: [{ id: calId, name: DEFAULT_CALENDAR_NAME, workDays: input.workDays ?? DEFAULT_WORK_DAYS, holidays: [], workExceptions: [], hoursPerDay: 8, isDefault: true }] },
      wbs: input.starterWbs === false ? undefined : { create: STARTER_WBS.map((name, i) => ({ code: String(i + 1), name, sortOrder: i + 1 })) },
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "PLAN_SCHEDULE", entityId: schedule.id, detail: schedule.name });
  return schedule;
}

export async function updateSchedule(projectId: string, input: UpdateScheduleInput, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.startDate) data.startDate = isoToDate(input.startDate);
  if (input.dataDate) data.dataDate = isoToDate(input.dataDate);
  await prisma.planSchedule.update({ where: { id: s.id }, data });

  if (input.calendar) {
    const cal = await prisma.planCalendar.findFirst({ where: { scheduleId: s.id, isDefault: true } }) ?? (await prisma.planCalendar.findFirst({ where: { scheduleId: s.id } }));
    const payload = { workDays: input.calendar.workDays, holidays: [...new Set(input.calendar.holidays)].sort(), hoursPerDay: input.calendar.hoursPerDay };
    if (cal) await prisma.planCalendar.update({ where: { id: cal.id }, data: payload });
    else {
      const created = await prisma.planCalendar.create({ data: { ...payload, name: DEFAULT_CALENDAR_NAME, workExceptions: [], isDefault: true, scheduleId: s.id } });
      await prisma.planSchedule.update({ where: { id: s.id }, data: { defaultCalendarId: created.id } });
    }
  }
  await recalculate(s.id);
  await logActivity({ userId, action: "UPDATE", entity: "PLAN_SCHEDULE", entityId: s.id, detail: input.name ?? s.name });
}

export async function deleteSchedule(projectId: string, userId: string) {
  const s = await scheduleOrThrow(projectId);
  await prisma.planSchedule.delete({ where: { id: s.id } });
  await logActivity({ userId, action: "DELETE", entity: "PLAN_SCHEDULE", entityId: s.id, detail: s.name });
}

// ------------------------------------------------------------------------------ WBS

export async function createWbs(projectId: string, input: WbsInput, userId: string) {
  const s = await scheduleOrThrow(projectId);
  if (input.parentId) {
    const parent = await prisma.planWbs.findFirst({ where: { id: input.parentId, scheduleId: s.id } });
    if (!parent) throw new PlanningError("Parent WBS not found");
  }
  const max = await prisma.planWbs.aggregate({ where: { scheduleId: s.id, parentId: input.parentId ?? null }, _max: { sortOrder: true } });
  const w = await prisma.planWbs.create({
    data: { scheduleId: s.id, code: input.code, name: input.name, parentId: input.parentId ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  await logActivity({ userId, action: "CREATE", entity: "PLAN_WBS", entityId: w.id, detail: w.name });
  return w;
}

export async function updateWbs(projectId: string, wbsId: string, input: WbsInput, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const w = await prisma.planWbs.findFirst({ where: { id: wbsId, scheduleId: s.id } });
  if (!w) throw new PlanningError("WBS not found", 404);
  if (input.parentId) {
    // A WBS cannot be moved beneath itself or one of its own descendants.
    const all = await prisma.planWbs.findMany({ where: { scheduleId: s.id }, select: { id: true, parentId: true } });
    let cur: string | null = input.parentId;
    while (cur) {
      if (cur === wbsId) throw new PlanningError("A WBS element cannot be moved inside itself.");
      cur = all.find((x) => x.id === cur)?.parentId ?? null;
    }
  }
  const updated = await prisma.planWbs.update({ where: { id: wbsId }, data: { code: input.code, name: input.name, parentId: input.parentId === undefined ? w.parentId : input.parentId } });
  await logActivity({ userId, action: "UPDATE", entity: "PLAN_WBS", entityId: wbsId, detail: updated.name });
  return updated;
}

export async function deleteWbs(projectId: string, wbsId: string, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const w = await prisma.planWbs.findFirst({ where: { id: wbsId, scheduleId: s.id } });
  if (!w) throw new PlanningError("WBS not found", 404);
  const [kids, acts] = await Promise.all([
    prisma.planWbs.count({ where: { parentId: wbsId } }),
    prisma.planActivity.count({ where: { wbsId } }),
  ]);
  if (kids > 0 || acts > 0) throw new PlanningError("Move or delete the activities and sub-elements inside this WBS first.", 409);
  await prisma.planWbs.delete({ where: { id: wbsId } });
  await logActivity({ userId, action: "DELETE", entity: "PLAN_WBS", entityId: wbsId, detail: w.name });
}

// ------------------------------------------------------------------------- activities

/** True if adding predecessor → successor would close a loop (successor already reaches predecessor). */
function wouldCreateCycle(rels: { predecessorId: string; successorId: string }[], predecessorId: string, successorId: string): boolean {
  const next = new Map<string, string[]>();
  for (const r of rels) (next.get(r.predecessorId) ?? next.set(r.predecessorId, []).get(r.predecessorId)!).push(r.successorId);
  const stack = [successorId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === predecessorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

async function nextCode(scheduleId: string) {
  const rows = await prisma.planActivity.findMany({ where: { scheduleId }, select: { code: true } });
  const nums = rows.map((r) => /^A(\d+)$/.exec(r.code)?.[1]).filter(Boolean).map(Number);
  return `A${(nums.length ? Math.max(...nums) : 990) + 10}`;
}

interface ProgressFields {
  percentComplete: number;
  actualStart: Date | null;
  actualFinish: Date | null;
  remainingDays: number | null;
}

/** Keep % complete, actual dates and remaining duration consistent with each other. */
function normalizeProgress(
  type: ActivityType, duration: number,
  want: { percentComplete?: number; actualStart?: string | null; actualFinish?: string | null; remainingDays?: number | null },
  current: { percentComplete: number; actualStart: Date | null; actualFinish: Date | null; remainingDays: number | null; earlyStart: Date | null },
  dataIso: string,
  durationChanged = false,
): ProgressFields {
  let pct = clamp(want.percentComplete ?? current.percentComplete, 0, 100);
  let start = want.actualStart === undefined ? i2(current.actualStart) : want.actualStart;
  let finish = want.actualFinish === undefined ? i2(current.actualFinish) : want.actualFinish;
  const plannedStart = i2(current.earlyStart) ?? dataIso;

  if (finish) {
    pct = 100;
    if (!start || start > finish) start = plannedStart <= finish ? plannedStart : finish;
  } else if (pct >= 100) {
    finish = dataIso;
    if (!start || start > finish) start = plannedStart <= finish ? plannedStart : finish;
  } else if (pct > 0 && !start) {
    start = plannedStart <= dataIso ? plannedStart : dataIso;
  }
  if (type !== "TASK") {
    // Milestones are either achieved or not.
    if (finish) start = finish;
    else { start = null; pct = 0; }
  }
  const inProgress = !!start && !finish;
  let remaining: number | null = null;
  if (inProgress && type === "TASK") {
    remaining = want.remainingDays != null
      ? want.remainingDays
      : want.percentComplete !== undefined || durationChanged || current.remainingDays == null
        ? round1(duration * (1 - pct / 100))
        : current.remainingDays;
  }
  return { percentComplete: pct, actualStart: d2(start), actualFinish: d2(finish), remainingDays: remaining };
}

async function replacePredecessors(scheduleId: string, activityId: string, preds: NonNullable<ActivityInput["predecessors"]>) {
  const [acts, rels] = await Promise.all([
    prisma.planActivity.findMany({ where: { scheduleId }, select: { id: true } }),
    prisma.planRelationship.findMany({ where: { scheduleId, NOT: { successorId: activityId } }, select: { predecessorId: true, successorId: true } }),
  ]);
  const ids = new Set(acts.map((a) => a.id));
  const accepted: typeof preds = [];
  const added: { predecessorId: string; successorId: string }[] = [...rels];
  const seen = new Set<string>();
  for (const p of preds) {
    if (p.activityId === activityId) throw new PlanningError("An activity cannot be its own predecessor.");
    if (!ids.has(p.activityId)) throw new PlanningError("Predecessor not found in this schedule.");
    const key = `${p.activityId}|${p.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (wouldCreateCycle(added, p.activityId, activityId)) {
      const pa = await prisma.planActivity.findUnique({ where: { id: p.activityId }, select: { code: true } });
      throw new PlanningError(`Linking to ${pa?.code ?? "that activity"} would create a logic loop.`);
    }
    added.push({ predecessorId: p.activityId, successorId: activityId });
    accepted.push(p);
  }
  await prisma.$transaction([
    prisma.planRelationship.deleteMany({ where: { successorId: activityId } }),
    prisma.planRelationship.createMany({ data: accepted.map((p) => ({ scheduleId, predecessorId: p.activityId, successorId: activityId, type: p.type, lagDays: p.lagDays })) }),
  ]);
}

async function checkRefs(scheduleId: string, wbsId?: string | null, calendarId?: string | null) {
  if (wbsId && !(await prisma.planWbs.findFirst({ where: { id: wbsId, scheduleId }, select: { id: true } }))) throw new PlanningError("WBS not found in this schedule.");
  if (calendarId && !(await prisma.planCalendar.findFirst({ where: { id: calendarId, scheduleId }, select: { id: true } }))) throw new PlanningError("Calendar not found in this schedule.");
}

export async function createActivity(projectId: string, input: ActivityInput, userId: string) {
  const s = await scheduleOrThrow(projectId);
  await checkRefs(s.id, input.wbsId, input.calendarId);
  const type = (input.type ?? "TASK") as ActivityType;
  const duration = type === "TASK" ? input.durationDays ?? 1 : 0;
  const code = input.code ?? (await nextCode(s.id));
  if (await prisma.planActivity.findUnique({ where: { scheduleId_code: { scheduleId: s.id, code } }, select: { id: true } })) {
    throw new PlanningError(`Activity ID "${code}" already exists.`, 409);
  }
  const max = await prisma.planActivity.aggregate({ where: { scheduleId: s.id }, _max: { sortOrder: true } });
  const prog = normalizeProgress(type, duration, input, { percentComplete: 0, actualStart: null, actualFinish: null, remainingDays: null, earlyStart: null }, dateToIso(s.dataDate));

  const a = await prisma.planActivity.create({
    data: {
      scheduleId: s.id, wbsId: input.wbsId ?? null, calendarId: input.calendarId ?? null, code, name: input.name, type, durationDays: duration,
      ...prog, constraintType: input.constraintType ?? null, constraintDate: input.constraintType ? d2(input.constraintDate ?? null) : null,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  try {
    if (input.predecessors?.length) await replacePredecessors(s.id, a.id, input.predecessors);
  } catch (e) {
    await prisma.planActivity.delete({ where: { id: a.id } });
    throw e;
  }
  await recalculate(s.id);
  await logActivity({ userId, action: "CREATE", entity: "PLAN_ACTIVITY", entityId: a.id, detail: `${a.code} ${a.name}` });
  return a;
}

export async function updateActivity(projectId: string, activityId: string, input: ActivityInput, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const cur = await prisma.planActivity.findFirst({ where: { id: activityId, scheduleId: s.id } });
  if (!cur) throw new PlanningError("Activity not found", 404);
  await checkRefs(s.id, input.wbsId, input.calendarId);

  const type = (input.type ?? cur.type) as ActivityType;
  const duration = type === "TASK" ? input.durationDays ?? cur.durationDays : 0;
  if (input.code && input.code !== cur.code) {
    if (await prisma.planActivity.findUnique({ where: { scheduleId_code: { scheduleId: s.id, code: input.code } }, select: { id: true } })) {
      throw new PlanningError(`Activity ID "${input.code}" already exists.`, 409);
    }
  }
  const durationChanged = duration !== cur.durationDays;
  const prog = normalizeProgress(type, duration, input, cur, dateToIso(s.dataDate), durationChanged);
  if (input.predecessors) await replacePredecessors(s.id, activityId, input.predecessors);

  await prisma.planActivity.update({
    where: { id: activityId },
    data: {
      name: input.name, code: input.code ?? cur.code, type, durationDays: duration,
      wbsId: input.wbsId === undefined ? cur.wbsId : input.wbsId,
      calendarId: input.calendarId === undefined ? cur.calendarId : input.calendarId,
      ...prog,
      ...(input.constraintType !== undefined
        ? { constraintType: input.constraintType, constraintDate: input.constraintType ? d2(input.constraintDate ?? null) : null }
        : {}),
    },
  });
  await recalculate(s.id);
  await logActivity({ userId, action: "UPDATE", entity: "PLAN_ACTIVITY", entityId: activityId, detail: `${input.code ?? cur.code} ${input.name}` });
}

export async function deleteActivity(projectId: string, activityId: string, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const a = await prisma.planActivity.findFirst({ where: { id: activityId, scheduleId: s.id } });
  if (!a) throw new PlanningError("Activity not found", 404);
  await prisma.planActivity.delete({ where: { id: activityId } });
  await recalculate(s.id);
  await logActivity({ userId, action: "DELETE", entity: "PLAN_ACTIVITY", entityId: activityId, detail: `${a.code} ${a.name}` });
}

// ------------------------------------------------------------- progress (follow-up)

export async function applyProgress(projectId: string, input: ProgressInput, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const dataIso = input.dataDate ?? dateToIso(s.dataDate);
  if (input.dataDate) await prisma.planSchedule.update({ where: { id: s.id }, data: { dataDate: isoToDate(input.dataDate) } });

  const ids = input.updates.map((u) => u.activityId);
  const current = await prisma.planActivity.findMany({ where: { scheduleId: s.id, id: { in: ids } } });
  const byId = new Map(current.map((a) => [a.id, a]));
  const ops = [];
  for (const u of input.updates) {
    const cur = byId.get(u.activityId);
    if (!cur) continue;
    const prog = normalizeProgress(cur.type as ActivityType, cur.durationDays, u, cur, dataIso);
    ops.push(prisma.planActivity.update({ where: { id: cur.id }, data: prog }));
  }
  if (ops.length) await prisma.$transaction(ops);
  await recalculate(s.id);

  // Remember overall progress at this data date so the "Actual" S-curve has history.
  const acts = await prisma.planActivity.findMany({ where: { scheduleId: s.id } });
  const pct = weightedProgress(
    acts.map((a) => ({
      id: a.id, wbsId: a.wbsId, code: a.code, name: a.name, type: a.type as ActivityType, calendarId: a.calendarId, durationDays: a.durationDays,
      remainingDays: a.remainingDays ?? a.durationDays, percentComplete: a.percentComplete, actualStart: i2(a.actualStart), actualFinish: i2(a.actualFinish),
      earlyStart: i2(a.earlyStart) ?? dataIso, earlyFinish: i2(a.earlyFinish) ?? dataIso, totalFloat: a.totalFloat ?? 0, isCritical: a.isCritical,
    })),
  );
  await prisma.planProgressSnapshot.upsert({
    where: { scheduleId_dataDate: { scheduleId: s.id, dataDate: d2(dataIso)! } },
    create: { scheduleId: s.id, dataDate: d2(dataIso)!, percent: round1(pct) },
    update: { percent: round1(pct) },
  });
  await logActivity({ userId, action: "UPDATE", entity: "PLAN_SCHEDULE", entityId: s.id, detail: `Progress update ${dataIso} (${round1(pct)}%)` });
  return { updated: ops.length, percent: round1(pct) };
}

// ---------------------------------------------------------------------------- baseline

export async function setBaseline(projectId: string, name: string | undefined, userId: string) {
  const s = await scheduleOrThrow(projectId);
  const acts = await prisma.planActivity.findMany({ where: { scheduleId: s.id } });
  if (acts.length === 0) throw new PlanningError("Add some activities before saving a baseline.");
  const data: BaselineMap = {};
  for (const a of acts) {
    if (a.earlyStart && a.earlyFinish) data[a.id] = { start: dateToIso(a.earlyStart), finish: dateToIso(a.earlyFinish) };
  }
  const count = await prisma.planBaseline.count({ where: { scheduleId: s.id } });
  await prisma.$transaction([
    prisma.planBaseline.updateMany({ where: { scheduleId: s.id }, data: { isPrimary: false } }),
    prisma.planBaseline.create({ data: { scheduleId: s.id, name: name ?? `Baseline ${count + 1}`, isPrimary: true, data: data as object, createdById: userId } }),
  ]);
  await logActivity({ userId, action: "CREATE", entity: "PLAN_SCHEDULE", entityId: s.id, detail: `Baseline saved (${acts.length} activities)` });
}

// ------------------------------------------------------------------ Primavera (XER)

export type ImportMode = "create" | "replace" | "update";

export interface ImportChanges {
  created: number; updated: number; unchanged: number; removed: number; keptNotInFile: number;
  wbsCreated: number; wbsUpdated: number; relationshipsFromFile: number; relationshipsKept: number;
}

export interface ImportReport {
  mode: ImportMode;
  /** True when nothing was written (a preview). */
  dryRun: boolean;
  activities: number;
  relationships: number;
  wbs: number;
  calendars: number;
  warnings: string[];
  /** Activities whose finish date, recalculated here, differs from the date stored in the XER. */
  dateDifferences: number;
  projects: { id: string; name: string; code: string }[];
  /** Only for mode "update": what changed compared with the schedule that was already there. */
  changes?: ImportChanges;
}

export interface ImportOptions {
  /** Which project of a multi-project XER to read. */
  projectId?: string;
  /** With an existing schedule: "update" (default) merges by Activity ID, "replace" wipes and re-creates. */
  mode?: "update" | "replace";
  /** update only: leave % complete, actual dates and remaining duration as they are here. */
  keepProgress?: boolean;
  /** update only: delete activities that are not in the file (otherwise they are kept). */
  removeMissing?: boolean;
  /** Work out and report the changes without writing anything. */
  dryRun?: boolean;
}

async function countDateDifferences(scheduleId: string, imp: ImportedSchedule) {
  const stored = await prisma.planActivity.findMany({ where: { scheduleId }, select: { p6Id: true, earlyFinish: true, actualFinish: true } });
  const p6Finish = new Map(imp.activities.map((a) => [a.p6Id, a.actualFinish ?? a.plannedFinish]));
  let n = 0;
  for (const a of stored) {
    const p6 = p6Finish.get(a.p6Id ?? "");
    const mine = i2(a.actualFinish ?? a.earlyFinish);
    if (p6 && mine && Math.abs(isoToDay(p6) - isoToDay(mine)) > 0) n++;
  }
  return n;
}

async function inChunks<T>(items: T[], size: number, fn: (t: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

const patchToDb = (p: ActivityPatch) => ({
  name: p.name, type: p.type, durationDays: p.durationDays, constraintType: p.constraintType, constraintDate: d2(p.constraintDate),
  wbsId: p.wbsId, calendarId: p.calendarId, sortOrder: p.sortOrder, p6Id: p.p6Id, p6Raw: p.raw as object,
  ...("percentComplete" in p ? { remainingDays: p.remainingDays ?? null, percentComplete: p.percentComplete, actualStart: d2(p.actualStart), actualFinish: d2(p.actualFinish) } : {}),
});

type ExistingSchedule = NonNullable<Awaited<ReturnType<typeof loadExistingForMerge>>>;
async function loadExistingForMerge(projectId: string) {
  return prisma.planSchedule.findUnique({ where: { projectId }, include: { activities: true, wbs: true, calendars: true } });
}

/** Merge an XER into the schedule that is already there instead of replacing it. */
async function mergeXer(existing: ExistingSchedule, imp: ImportedSchedule, opts: ImportOptions, userId: string): Promise<ImportReport> {
  const keepProgress = !!opts.keepProgress, removeMissing = !!opts.removeMissing;
  const plan = planMerge(
    {
      activities: existing.activities.map((a) => ({
        id: a.id, code: a.code, name: a.name, type: a.type, durationDays: a.durationDays, remainingDays: a.remainingDays, percentComplete: a.percentComplete,
        actualStart: i2(a.actualStart), actualFinish: i2(a.actualFinish), constraintType: a.constraintType, constraintDate: i2(a.constraintDate),
        wbsId: a.wbsId, calendarId: a.calendarId, sortOrder: a.sortOrder, p6Id: a.p6Id, raw: a.p6Raw && typeof a.p6Raw === "object" ? (a.p6Raw as Record<string, string>) : null,
      })),
      wbs: existing.wbs.map((w) => ({ id: w.id, code: w.code, name: w.name, parentId: w.parentId, sortOrder: w.sortOrder, p6Id: w.p6Id })),
      calendars: existing.calendars.map((c) => ({ id: c.id, name: c.name, p6Id: c.p6Id, workDays: c.workDays as boolean[], holidays: c.holidays as string[], workExceptions: c.workExceptions as string[], hoursPerDay: c.hoursPerDay })),
    },
    imp, { keepProgress, removeMissing }, randomUUID,
  );
  const oldRels = await prisma.planRelationship.findMany({ where: { scheduleId: existing.id }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } });
  const rels = mergeRelationships(oldRels.map((r) => ({ ...r, type: r.type as RelType })), imp.relationships, plan.activityIds, new Set(plan.keptOnly));

  const updatedCount = plan.activitiesUpdate.filter((u) => u.businessChange).length;
  const changes: ImportChanges = {
    created: plan.activitiesCreate.length, updated: updatedCount, unchanged: imp.activities.length - plan.activitiesCreate.length - updatedCount,
    removed: plan.activitiesRemove.length, keptNotInFile: plan.keptOnly.length, wbsCreated: plan.wbsCreate.length, wbsUpdated: plan.wbsUpdate.length,
    relationshipsFromFile: rels.fromFile, relationshipsKept: rels.kept,
  };
  const report: ImportReport = {
    mode: "update", dryRun: !!opts.dryRun, activities: imp.activities.length, relationships: imp.relationships.length, wbs: imp.wbs.length, calendars: imp.calendars.length,
    warnings: [...imp.warnings], dateDifferences: 0, projects: imp.projects, changes,
  };
  if (plan.keptOnly.length) report.warnings.push(`${plan.keptOnly.length} activities in the web schedule are not in the file — they were kept. Tick “remove activities that are not in the file” to delete them.`);
  if (opts.dryRun) return report;

  const startDate = imp.startDate ?? dateToIso(existing.startDate);
  const withActuals = imp.activities.flatMap((a) => [a.actualStart, a.actualFinish]).filter(Boolean) as string[];
  const dataDate = keepProgress ? dateToIso(existing.dataDate) : imp.dataDate ?? (withActuals.length ? withActuals.sort().pop()! : dateToIso(existing.dataDate));
  const defaultP6 = imp.defaultCalendarP6Id ?? imp.calendars[0]?.p6Id;
  const defaultCalendarId = (defaultP6 && plan.calendarIds.get(defaultP6)) || existing.defaultCalendarId;
  const scheduleId = existing.id;

  await prisma.$transaction(
    async (tx) => {
      await tx.planSchedule.update({ where: { id: scheduleId }, data: { startDate: d2(startDate)!, dataDate: d2(dataDate)!, source: "XER", p6ProjectId: imp.p6ProjectId, defaultCalendarId } });

      const calData = (c: (typeof plan.calendarsCreate)[number]["cal"]) => ({ name: c.name, workDays: c.workDays, holidays: c.holidays, workExceptions: c.workExceptions, hoursPerDay: c.hoursPerDay, p6Id: c.p6Id });
      if (plan.calendarsCreate.length) await tx.planCalendar.createMany({ data: plan.calendarsCreate.map((c) => ({ id: c.id, scheduleId, ...calData(c.cal) })) });
      await inChunks(plan.calendarsUpdate, 20, (c) => tx.planCalendar.update({ where: { id: c.id }, data: calData(c.cal) }));
      if (defaultCalendarId) {
        await tx.planCalendar.updateMany({ where: { scheduleId }, data: { isDefault: false } });
        await tx.planCalendar.update({ where: { id: defaultCalendarId }, data: { isDefault: true } });
      }

      if (plan.wbsCreate.length) {
        await tx.planWbs.createMany({
          data: plan.wbsCreate.map(({ id, w }) => ({ id, scheduleId, code: w.code.slice(0, 30), name: w.name, sortOrder: w.sortOrder, parentId: w.parentP6Id ? plan.wbsIds.get(w.parentP6Id) ?? null : null, p6Id: w.p6Id })),
        });
      }
      await inChunks(plan.wbsUpdate, 30, (w) => tx.planWbs.update({ where: { id: w.id }, data: w.data }));

      if (plan.activitiesRemove.length) await tx.planActivity.deleteMany({ where: { id: { in: plan.activitiesRemove } } });
      if (plan.activitiesCreate.length) {
        await tx.planActivity.createMany({
          data: plan.activitiesCreate.map(({ id, a, code, sortOrder }) => ({
            id, scheduleId, wbsId: a.wbsP6Id ? plan.wbsIds.get(a.wbsP6Id) ?? null : null, calendarId: a.calendarP6Id ? plan.calendarIds.get(a.calendarP6Id) ?? null : null,
            code, name: a.name.slice(0, 200), type: a.type, durationDays: a.durationDays, remainingDays: a.remainingDays, percentComplete: a.percentComplete,
            actualStart: d2(a.actualStart), actualFinish: d2(a.actualFinish), constraintType: a.constraintType, constraintDate: d2(a.constraintDate), sortOrder, p6Id: a.p6Id, p6Raw: a.raw as object,
          })),
        });
      }
      await inChunks(plan.activitiesUpdate, 40, (u) => tx.planActivity.update({ where: { id: u.id }, data: patchToDb(u.data) }));
      await inChunks(plan.keptSort, 40, (k) => tx.planActivity.update({ where: { id: k.id }, data: { sortOrder: k.sortOrder } }));

      await tx.planRelationship.deleteMany({ where: { scheduleId } });
      if (rels.rows.length) await tx.planRelationship.createMany({ data: rels.rows.map((r) => ({ scheduleId, ...r })), skipDuplicates: true });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  await recalculate(scheduleId);
  report.dateDifferences = await countDateDifferences(scheduleId, imp);
  const sch = await prisma.planSchedule.findUnique({ where: { id: scheduleId }, select: { calcError: true } });
  if (sch?.calcError) report.warnings.push(sch.calcError);
  await logActivity({
    userId, action: "UPDATE", entity: "PLAN_SCHEDULE", entityId: scheduleId,
    detail: `Updated schedule from XER "${imp.name}": ${changes.created} new, ${changes.updated} changed, ${changes.removed} removed`,
  });
  return report;
}

export async function importXer(projectId: string, text: string, opts: ImportOptions, userId: string): Promise<ImportReport> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new PlanningError("Project not found", 404);

  let imp;
  try {
    imp = xerToSchedule(parseXer(text), { projectId: opts.projectId });
  } catch (e) {
    throw new PlanningError(e instanceof Error ? e.message : "Could not read this XER file.");
  }
  if (imp.activities.length === 0) throw new PlanningError("The XER file has no activities for the selected project.");

  const existing = await loadExistingForMerge(projectId);
  const mode: ImportMode = !existing ? "create" : opts.mode ?? "update";
  if (existing && mode === "update") return mergeXer(existing, imp, opts, userId);
  if (opts.dryRun) {
    return { mode, dryRun: true, activities: imp.activities.length, relationships: imp.relationships.length, wbs: imp.wbs.length, calendars: imp.calendars.length, warnings: [...imp.warnings], dateDifferences: 0, projects: imp.projects };
  }

  const calIds = new Map<string, string>();
  const calendars = imp.calendars.length
    ? imp.calendars
    : [{ p6Id: "default", name: DEFAULT_CALENDAR_NAME, workDays: DEFAULT_WORK_DAYS, holidays: [], workExceptions: [], hoursPerDay: 8 }];
  for (const c of calendars) calIds.set(c.p6Id, randomUUID());
  const defaultP6 = imp.defaultCalendarP6Id ?? calendars[0].p6Id;
  const wbsIds = new Map(imp.wbs.map((w) => [w.p6Id, randomUUID()]));
  const actIds = new Map(imp.activities.map((a) => [a.p6Id, randomUUID()]));

  const withActuals = imp.activities.flatMap((a) => [a.actualStart, a.actualFinish]).filter(Boolean) as string[];
  const startDate = imp.startDate ?? imp.activities.map((a) => a.plannedStart).filter(Boolean).sort()[0] ?? dateToIso(new Date());
  const dataDate = imp.dataDate ?? (withActuals.length ? withActuals.sort().pop()! : startDate);

  // Activity codes must be unique within a schedule.
  const usedCodes = new Set<string>();
  const codeFor = (code: string) => {
    let c = code.slice(0, 30);
    for (let n = 2; usedCodes.has(c); n++) c = `${code.slice(0, 26)}-${n}`;
    usedCodes.add(c);
    return c;
  };

  // WBS parents must be inserted before their children.
  const wbsOrdered: typeof imp.wbs = [];
  const placed = new Set<string>();
  const pending = [...imp.wbs];
  while (pending.length) {
    const before = pending.length;
    for (let i = pending.length - 1; i >= 0; i--) {
      const w = pending[i];
      if (!w.parentP6Id || placed.has(w.parentP6Id) || !wbsIds.has(w.parentP6Id)) { wbsOrdered.push(w); placed.add(w.p6Id); pending.splice(i, 1); }
    }
    if (pending.length === before) { wbsOrdered.push(...pending.splice(0)); } // broken parent chain: keep the rest anyway
  }

  const scheduleId = randomUUID();
  await prisma.$transaction(
    async (tx) => {
      await tx.planSchedule.deleteMany({ where: { projectId } });
      await tx.planSchedule.create({
        data: {
          id: scheduleId, projectId, name: imp.name, startDate: d2(startDate)!, dataDate: d2(dataDate)!, source: "XER", p6ProjectId: imp.p6ProjectId,
          defaultCalendarId: calIds.get(defaultP6) ?? null, createdById: userId,
        },
      });
      await tx.planCalendar.createMany({
        data: calendars.map((c) => ({
          id: calIds.get(c.p6Id)!, scheduleId, name: c.name, workDays: c.workDays, holidays: c.holidays, workExceptions: c.workExceptions,
          hoursPerDay: c.hoursPerDay, isDefault: c.p6Id === defaultP6, p6Id: c.p6Id,
        })),
      });
      if (wbsOrdered.length) {
        await tx.planWbs.createMany({
          data: wbsOrdered.map((w) => ({
            id: wbsIds.get(w.p6Id)!, scheduleId, code: w.code.slice(0, 30), name: w.name, sortOrder: w.sortOrder,
            parentId: w.parentP6Id ? wbsIds.get(w.parentP6Id) ?? null : null, p6Id: w.p6Id,
          })),
        });
      }
      await tx.planActivity.createMany({
        data: imp.activities.map((a, i) => ({
          id: actIds.get(a.p6Id)!, scheduleId, wbsId: a.wbsP6Id ? wbsIds.get(a.wbsP6Id) ?? null : null,
          calendarId: a.calendarP6Id ? calIds.get(a.calendarP6Id) ?? null : null,
          code: codeFor(a.code), name: a.name.slice(0, 200), type: a.type, durationDays: a.durationDays, remainingDays: a.remainingDays,
          percentComplete: a.percentComplete, actualStart: d2(a.actualStart), actualFinish: d2(a.actualFinish),
          constraintType: a.constraintType, constraintDate: d2(a.constraintDate), sortOrder: i, p6Id: a.p6Id, p6Raw: a.raw as object,
        })),
      });
      await tx.planRelationship.createMany({
        data: imp.relationships
          .filter((r) => actIds.has(r.predP6Id) && actIds.has(r.succP6Id))
          .map((r) => ({ scheduleId, predecessorId: actIds.get(r.predP6Id)!, successorId: actIds.get(r.succP6Id)!, type: r.type, lagDays: r.lagDays })),
        skipDuplicates: true,
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  await recalculate(scheduleId);

  const dateDifferences = await countDateDifferences(scheduleId, imp);
  const sch = await prisma.planSchedule.findUnique({ where: { id: scheduleId }, select: { calcError: true } });
  const warnings = [...imp.warnings];
  if (sch?.calcError) warnings.push(sch.calcError);

  await logActivity({ userId, action: "CREATE", entity: "PLAN_SCHEDULE", entityId: scheduleId, detail: `Imported XER "${imp.name}" (${imp.activities.length} activities)` });
  return {
    mode, dryRun: false, activities: imp.activities.length, relationships: imp.relationships.length, wbs: imp.wbs.length, calendars: calendars.length,
    warnings, dateDifferences, projects: imp.projects,
  };
}

export async function buildExportSchedule(projectId: string): Promise<ExportSchedule> {
  const s = await loadFull(projectId);
  if (!s) throw new PlanningError("This project has no schedule yet.", 404);
  const startIso = dateToIso(s.startDate);
  return {
    name: s.name,
    code: s.name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 20) || "PROJECT",
    startDate: startIso,
    dataDate: dateToIso(s.dataDate),
    finishDate: i2(s.finishDate),
    calendars: s.calendars.map((c) => ({ ...toCalendarDef(c), p6Id: c.p6Id })),
    wbs: s.wbs.map((w) => ({ id: w.id, p6Id: w.p6Id, parentId: w.parentId, code: w.code, name: w.name, sortOrder: w.sortOrder })),
    activities: s.activities.map((a) => ({
      id: a.id, p6Id: a.p6Id, wbsId: a.wbsId, calendarId: a.calendarId, code: a.code, name: a.name, type: a.type as ActivityType,
      durationDays: a.durationDays, remainingDays: a.remainingDays, percentComplete: a.percentComplete,
      actualStart: i2(a.actualStart), actualFinish: i2(a.actualFinish), earlyStart: i2(a.earlyStart), earlyFinish: i2(a.earlyFinish),
      lateStart: i2(a.lateStart), lateFinish: i2(a.lateFinish), totalFloat: a.totalFloat,
      constraintType: a.constraintType, constraintDate: i2(a.constraintDate),
      raw: a.p6Raw && typeof a.p6Raw === "object" ? (a.p6Raw as Record<string, string>) : null,
    })),
    relationships: s.relationships.map((r) => ({ predecessorId: r.predecessorId, successorId: r.successorId, type: r.type as RelType, lagDays: r.lagDays })),
  };
}

export async function exportXer(projectId: string): Promise<string> {
  return writeXer(await buildExportSchedule(projectId));
}
