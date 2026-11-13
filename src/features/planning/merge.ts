// "Update instead of replace" for XER imports: match what is already in the schedule against the
// file and work out exactly what to create / update / remove. Pure (no Prisma) so it is testable.
//
//  - Activities are matched by Activity ID (code), so their database ids — and everything that
//    points at them (baseline, materials, history) — survive the import.
//  - WBS elements are matched by their code path (e.g. 1/1.2), calendars by P6 id or name.
//  - Only rows whose values really changed are returned for update.

import type { ImportedActivity, ImportedCalendar, ImportedRel, ImportedSchedule, ImportedWbs } from "./xer";
import type { RelType } from "./types";

export interface ExistingActivity {
  id: string; code: string; name: string; type: string; durationDays: number; remainingDays: number | null; percentComplete: number;
  actualStart: string | null; actualFinish: string | null; constraintType: string | null; constraintDate: string | null;
  wbsId: string | null; calendarId: string | null; sortOrder: number; p6Id: string | null; raw: Record<string, string> | null;
}
export interface ExistingWbs { id: string; code: string; name: string; parentId: string | null; sortOrder: number; p6Id: string | null }
export interface ExistingCalendar { id: string; name: string; p6Id: string | null; workDays: boolean[]; holidays: string[]; workExceptions: string[]; hoursPerDay: number }
export interface ExistingRel { predecessorId: string; successorId: string; type: RelType; lagDays: number }

export interface MergeOptions { keepProgress: boolean; removeMissing: boolean }

export interface ActivityPatch {
  name: string; type: ImportedActivity["type"]; durationDays: number; constraintType: string | null; constraintDate: string | null;
  wbsId: string | null; calendarId: string | null; sortOrder: number; p6Id: string; raw: Record<string, string>;
  remainingDays?: number | null; percentComplete?: number; actualStart?: string | null; actualFinish?: string | null;
}

export interface MergePlan {
  calendarIds: Map<string, string>;
  calendarsCreate: { id: string; cal: ImportedCalendar }[];
  calendarsUpdate: { id: string; cal: ImportedCalendar }[];
  wbsIds: Map<string, string>;
  wbsCreate: { id: string; w: ImportedWbs }[]; // parents first
  wbsUpdate: { id: string; data: { code: string; name: string; sortOrder: number; parentId: string | null; p6Id: string } }[];
  activityIds: Map<string, string>;
  activitiesCreate: { id: string; a: ImportedActivity; code: string; sortOrder: number }[];
  activitiesUpdate: { id: string; data: ActivityPatch; businessChange: boolean }[];
  /** Existing activities that are not in the file (and are kept). */
  keptOnly: string[];
  /** New sort positions for the kept ones: they go behind the activities of the file. */
  keptSort: { id: string; sortOrder: number }[];
  /** Existing activities that are not in the file (and are removed). */
  activitiesRemove: string[];
  unchanged: number;
}

const eq = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-6);
const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
const sameRaw = (a: Record<string, string> | null, b: Record<string, string>) => {
  if (!a) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && kb.every((k) => a[k] === b[k]);
};

function wbsPaths<T extends { code: string }>(items: T[], idOf: (t: T) => string, parentOf: (t: T) => string | null): Map<string, string> {
  const byId = new Map(items.map((i) => [idOf(i), i]));
  const out = new Map<string, string>();
  for (const it of items) {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (let cur: T | undefined = it; cur && !seen.has(idOf(cur)); cur = parentOf(cur) ? byId.get(parentOf(cur)!) : undefined) {
      seen.add(idOf(cur));
      parts.unshift(cur.code);
    }
    out.set(idOf(it), parts.join("/"));
  }
  return out;
}

export function planMerge(
  existing: { activities: ExistingActivity[]; wbs: ExistingWbs[]; calendars: ExistingCalendar[] },
  imp: ImportedSchedule,
  opts: MergeOptions,
  newId: () => string,
): MergePlan {
  // ------------------------------------------------------------ calendars
  const calendarIds = new Map<string, string>();
  const calendarsCreate: MergePlan["calendarsCreate"] = [];
  const calendarsUpdate: MergePlan["calendarsUpdate"] = [];
  const usedCal = new Set<string>();
  for (const cal of imp.calendars) {
    const match = existing.calendars.find((c) => !usedCal.has(c.id) && c.p6Id != null && c.p6Id === cal.p6Id)
      ?? existing.calendars.find((c) => !usedCal.has(c.id) && c.name.trim().toLowerCase() === cal.name.trim().toLowerCase());
    if (match) {
      usedCal.add(match.id);
      calendarIds.set(cal.p6Id, match.id);
      const changed = match.name !== cal.name || match.p6Id !== cal.p6Id || !eq(match.hoursPerDay, cal.hoursPerDay)
        || JSON.stringify(match.workDays) !== JSON.stringify(cal.workDays) || !sameList(match.holidays, cal.holidays) || !sameList(match.workExceptions, cal.workExceptions);
      if (changed) calendarsUpdate.push({ id: match.id, cal });
    } else {
      const id = newId();
      calendarIds.set(cal.p6Id, id);
      calendarsCreate.push({ id, cal });
    }
  }

  // ------------------------------------------------------------------ WBS
  const exPaths = wbsPaths(existing.wbs, (w) => w.id, (w) => w.parentId);
  const exByPath = new Map<string, ExistingWbs>();
  for (const w of existing.wbs) { const p = exPaths.get(w.id)!; if (!exByPath.has(p)) exByPath.set(p, w); }
  const xerPaths = wbsPaths(imp.wbs, (w) => w.p6Id, (w) => w.parentP6Id);
  const wbsIds = new Map<string, string>();
  const claimed = new Set<string>();
  const matched = new Map<string, ExistingWbs>();
  const toCreate: ImportedWbs[] = [];
  for (const w of imp.wbs) {
    const hit = exByPath.get(xerPaths.get(w.p6Id)!);
    if (hit && !claimed.has(hit.id)) { claimed.add(hit.id); matched.set(w.p6Id, hit); wbsIds.set(w.p6Id, hit.id); }
    else { wbsIds.set(w.p6Id, newId()); toCreate.push(w); }
  }
  const depth = (w: ImportedWbs) => xerPaths.get(w.p6Id)!.split("/").length;
  const wbsCreate = [...toCreate].sort((a, b) => depth(a) - depth(b)).map((w) => ({ id: wbsIds.get(w.p6Id)!, w }));
  const wbsUpdate: MergePlan["wbsUpdate"] = [];
  for (const w of imp.wbs) {
    const ex = matched.get(w.p6Id);
    if (!ex) continue;
    const parentId = w.parentP6Id ? wbsIds.get(w.parentP6Id) ?? null : null;
    const code = w.code.slice(0, 30);
    if (ex.name !== w.name || ex.code !== code || ex.sortOrder !== w.sortOrder || ex.parentId !== parentId || ex.p6Id !== w.p6Id) {
      wbsUpdate.push({ id: ex.id, data: { code, name: w.name, sortOrder: w.sortOrder, parentId, p6Id: w.p6Id } });
    }
  }

  // ----------------------------------------------------------- activities
  const byCode = new Map(existing.activities.map((a) => [a.code, a]));
  const usedCodes = new Set(existing.activities.map((a) => a.code));
  const claimedAct = new Set<string>();
  const activityIds = new Map<string, string>();
  const activitiesCreate: MergePlan["activitiesCreate"] = [];
  const activitiesUpdate: MergePlan["activitiesUpdate"] = [];
  let unchanged = 0;

  imp.activities.forEach((a, i) => {
    const code = a.code.slice(0, 30);
    const ex = byCode.get(code);
    const wbsId = a.wbsP6Id ? wbsIds.get(a.wbsP6Id) ?? null : null;
    if (ex && !claimedAct.has(ex.id)) {
      claimedAct.add(ex.id);
      activityIds.set(a.p6Id, ex.id);
      const calendarId = a.calendarP6Id ? calendarIds.get(a.calendarP6Id) ?? null : ex.calendarId;
      const data: ActivityPatch = {
        name: a.name.slice(0, 200), type: a.type, durationDays: a.durationDays, constraintType: a.constraintType, constraintDate: a.constraintDate,
        wbsId, calendarId, sortOrder: i, p6Id: a.p6Id, raw: a.raw,
      };
      if (!opts.keepProgress) {
        data.remainingDays = a.remainingDays; data.percentComplete = a.percentComplete; data.actualStart = a.actualStart; data.actualFinish = a.actualFinish;
      }
      const business =
        ex.name !== data.name || ex.type !== data.type || !eq(ex.durationDays, data.durationDays) || ex.constraintType !== data.constraintType
        || ex.constraintDate !== data.constraintDate || ex.wbsId !== wbsId || ex.calendarId !== calendarId
        || (!opts.keepProgress && (!eq(ex.remainingDays, a.remainingDays) || !eq(ex.percentComplete, a.percentComplete) || ex.actualStart !== a.actualStart || ex.actualFinish !== a.actualFinish));
      const other = ex.sortOrder !== i || ex.p6Id !== a.p6Id || !sameRaw(ex.raw, a.raw);
      if (business || other) activitiesUpdate.push({ id: ex.id, data, businessChange: business });
      else unchanged++;
    } else {
      let c = code;
      for (let n = 2; usedCodes.has(c); n++) c = `${code.slice(0, 26)}-${n}`;
      usedCodes.add(c);
      const id = newId();
      activityIds.set(a.p6Id, id);
      activitiesCreate.push({ id, a, code: c, sortOrder: i });
    }
  });

  const notInFile = existing.activities.filter((a) => !claimedAct.has(a.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const activitiesRemove = opts.removeMissing ? notInFile.map((a) => a.id) : [];
  const keptOnly = opts.removeMissing ? [] : notInFile.map((a) => a.id);
  // Activities kept from before go after the ones in the file, in their old order.
  const keptSort: MergePlan["keptSort"] = [];
  if (!opts.removeMissing) notInFile.forEach((a, n) => { const order = imp.activities.length + n; if (a.sortOrder !== order) keptSort.push({ id: a.id, sortOrder: order }); });

  return { calendarIds, calendarsCreate, calendarsUpdate, wbsIds, wbsCreate, wbsUpdate, activityIds, activitiesCreate, activitiesUpdate, keptOnly, keptSort, activitiesRemove, unchanged };
}

/** Logic from the file replaces the logic between file activities; links that touch an activity
 *  that is only in the web schedule are kept. */
export function mergeRelationships(existing: ExistingRel[], xer: ImportedRel[], activityIds: Map<string, string>, keptOnly: Set<string>) {
  const rows = new Map<string, ExistingRel>();
  const key = (r: ExistingRel) => `${r.predecessorId}>${r.successorId}:${r.type}`;
  let fromFile = 0;
  for (const r of xer) {
    const p = activityIds.get(r.predP6Id), s = activityIds.get(r.succP6Id);
    if (!p || !s || p === s) continue;
    const row = { predecessorId: p, successorId: s, type: r.type, lagDays: r.lagDays };
    if (!rows.has(key(row))) { rows.set(key(row), row); fromFile++; }
  }
  let kept = 0;
  for (const r of existing) {
    if ((keptOnly.has(r.predecessorId) || keptOnly.has(r.successorId)) && !rows.has(key(r))) { rows.set(key(r), r); kept++; }
  }
  return { rows: [...rows.values()], fromFile, kept };
}
