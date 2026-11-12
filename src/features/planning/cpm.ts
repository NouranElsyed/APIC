// Critical Path Method — forward / backward pass over working calendars.
//
// Conventions (kept deliberately close to Primavera P6):
//  • An activity starts at the START of its early-start day and finishes at the
//    END of its early-finish day. A 3-day task starting Sunday finishes Tuesday.
//  • Zero-duration milestones sit on one date: a *start* milestone at the start of
//    that day, a *finish* milestone at the end of it.
//  • FS links the successor to the next working day after the predecessor ends.
//  • Lags are counted in working days of the SUCCESSOR's calendar.
//  • Float is *total float* measured finish-to-finish in working days of the
//    activity's own calendar. Float ≤ 0 on an unfinished activity = critical.
//  • Completed activities keep their actual dates; in-progress activities keep
//    their actual start and finish `remaining` working days after the data date.
//    Activities that have not started cannot start before the data date.

import { DEFAULT_WORK_DAYS, WorkCalendar, dayToIso, isoToDay } from "./calendar";
import type { ActivityInput, CpmActivityResult, CpmInput, CpmResult, RelInput } from "./types";

interface State {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  effD: number; // duration used for backward calculation (remaining for in-progress)
  complete: boolean;
  inProgress: boolean;
  remaining: number;
}

/** Number of working days a duration spans beyond its first day (3d → 2, 0d/milestone → 0). */
const span = (d: number) => (d > 0 ? Math.max(0, Math.ceil(d) - 1) : 0);

export function runCpm(input: CpmInput): CpmResult {
  const calMap = new Map<string, WorkCalendar>();
  for (const c of input.calendars) calMap.set(c.id, new WorkCalendar(c));
  const defCal =
    calMap.get(input.defaultCalendarId) ??
    new WorkCalendar({ workDays: DEFAULT_WORK_DAYS, holidays: [], workExceptions: [], hoursPerDay: 8 });

  const acts = new Map<string, ActivityInput>();
  for (const a of input.activities) acts.set(a.id, a);
  const calOf = (a: ActivityInput) => (a.calendarId ? calMap.get(a.calendarId) : undefined) ?? defCal;

  // Keep only links between known activities (drop self-links and duplicates of the same pair+type).
  const seen = new Set<string>();
  const rels: RelInput[] = [];
  for (const r of input.relationships) {
    if (r.predecessorId === r.successorId || !acts.has(r.predecessorId) || !acts.has(r.successorId)) continue;
    const key = `${r.predecessorId}|${r.successorId}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rels.push(r);
  }
  const preds = new Map<string, RelInput[]>();
  const succs = new Map<string, RelInput[]>();
  for (const r of rels) {
    (preds.get(r.successorId) ?? preds.set(r.successorId, []).get(r.successorId)!).push(r);
    (succs.get(r.predecessorId) ?? succs.set(r.predecessorId, []).get(r.predecessorId)!).push(r);
  }

  // Topological order (Kahn). Anything left over sits on a logic loop.
  const indeg = new Map<string, number>();
  for (const a of input.activities) indeg.set(a.id, (preds.get(a.id) ?? []).length);
  const queue = input.activities.filter((a) => indeg.get(a.id) === 0).map((a) => a.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const r of succs.get(id) ?? []) {
      const n = (indeg.get(r.successorId) ?? 0) - 1;
      indeg.set(r.successorId, n);
      if (n === 0) queue.push(r.successorId);
    }
  }
  if (order.length < input.activities.length) {
    const inOrder = new Set(order);
    return {
      ok: false,
      cycleIds: input.activities.filter((a) => !inOrder.has(a.id)).map((a) => a.id),
      activities: {},
      projectStart: null,
      projectFinish: null,
    };
  }
  if (order.length === 0) return { ok: true, cycleIds: [], activities: {}, projectStart: null, projectFinish: null };

  const projStartDay = isoToDay(input.projectStart);
  const dataDay = Math.max(isoToDay(input.dataDate), projStartDay);
  const st = new Map<string, State>();

  // "End of the predecessor" as seen by a successor.
  const predEnd = (p: ActivityInput, ps: State, s: ActivityInput, cal: WorkCalendar) =>
    p.type === "MILESTONE_START" && s.type !== "MILESTONE_FINISH" ? cal.prevWork(ps.es - 1) : ps.ef;

  // ---------------------------------------------------------------- forward pass
  for (const id of order) {
    const a = acts.get(id)!;
    const cal = calOf(a);
    const milestone = a.type !== "TASK";
    const D = milestone ? 0 : Math.max(0, a.durationDays);
    const complete = a.actualFinish != null || a.percentComplete >= 100;

    if (a.actualFinish) {
      const ef = isoToDay(a.actualFinish);
      const es = a.actualStart ? Math.min(isoToDay(a.actualStart), ef) : ef;
      st.set(id, { es, ef, ls: es, lf: ef, effD: 0, complete: true, inProgress: false, remaining: 0 });
      continue;
    }

    const inProgress = !complete && a.actualStart != null && !milestone;
    const remaining = inProgress
      ? Math.max(0, a.remainingDays ?? Math.round(D * (1 - Math.min(100, Math.max(0, a.percentComplete)) / 100)))
      : D;

    // Candidate dates imposed by predecessors.
    let esMin = -Infinity;
    let efMin = -Infinity; // lower bound on finish (FF / SF / FNET)
    for (const r of preds.get(id) ?? []) {
      const p = acts.get(r.predecessorId)!;
      const ps = st.get(r.predecessorId)!;
      const end = predEnd(p, ps, a, cal);
      const lag = r.lagDays;
      if (r.type === "FS") {
        if (a.type === "MILESTONE_FINISH") efMin = Math.max(efMin, cal.shift(cal.prevWork(end), lag));
        else esMin = Math.max(esMin, cal.shift(cal.nextWork(end + 1), lag));
      } else if (r.type === "SS") {
        esMin = Math.max(esMin, cal.shift(cal.nextWork(ps.es), lag));
      } else if (r.type === "FF") {
        efMin = Math.max(efMin, cal.shift(cal.prevWork(end), lag));
      } else {
        efMin = Math.max(efMin, cal.shift(cal.prevWork(ps.es - 1), lag));
      }
    }

    // Constraints.
    if (a.constraintDate) {
      const cd = isoToDay(a.constraintDate);
      if (a.constraintType === "SNET") esMin = Math.max(esMin, cal.nextWork(cd));
      if (a.constraintType === "FNET") efMin = Math.max(efMin, cal.nextWork(cd));
    }

    let es: number;
    let ef: number;
    if (inProgress) {
      es = isoToDay(a.actualStart!);
      const remStart = cal.nextWork(Math.max(dataDay, es));
      ef = remaining > 0 ? cal.shift(remStart, span(remaining)) : cal.prevWork(Math.max(dataDay, es));
      if (efMin > ef) ef = efMin;
      if (ef < es) ef = es;
    } else {
      const floor = cal.nextWork(Math.max(projStartDay, dataDay));
      es = cal.nextWork(Math.max(floor, esMin === -Infinity ? floor : esMin));
      const sp = span(D);
      if (efMin !== -Infinity) {
        const esFromEf = sp > 0 ? cal.shift(efMin, -sp) : efMin;
        if (esFromEf > es) es = cal.nextWork(esFromEf);
      }
      ef = sp > 0 ? cal.shift(es, sp) : es;
    }
    st.set(id, { es, ef, ls: es, lf: ef, effD: remaining, complete, inProgress, remaining });
  }

  let projFinish = -Infinity;
  let projStart = Infinity;
  for (const s of st.values()) {
    projFinish = Math.max(projFinish, s.ef);
    projStart = Math.min(projStart, s.es);
  }

  // --------------------------------------------------------------- backward pass
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const a = acts.get(id)!;
    const s0 = st.get(id)!;
    if (s0.complete && a.actualFinish) continue; // fixed: ls/lf already = es/ef

    const cal = calOf(a);
    const sp = span(s0.effD);
    let lf = cal.prevWork(projFinish);

    for (const r of succs.get(id) ?? []) {
      const s = acts.get(r.successorId)!;
      const ss = st.get(r.successorId)!;
      const sc = calOf(s);
      const sIsFinishMs = s.type === "MILESTONE_FINISH";
      const sDate = sIsFinishMs ? ss.lf : ss.ls;
      const lag = r.lagDays;
      let cand: number;
      if (r.type === "FS") {
        if (sIsFinishMs) {
          cand = cal.prevWork(sc.shift(sDate, -lag));
        } else {
          const x = sc.shift(sc.nextWork(sDate), -lag);
          cand = a.type === "MILESTONE_START" ? cal.prevWork(x) : cal.prevWork(sc.prevWork(x - 1));
        }
      } else if (r.type === "SS") {
        const ls = cal.prevWork(sc.shift(sc.nextWork(sDate), -lag));
        cand = sp > 0 ? cal.shift(ls, sp) : ls;
      } else if (r.type === "FF") {
        cand = cal.prevWork(sc.shift(ss.lf, -lag));
      } else {
        const ls = cal.nextWork(sc.shift(ss.lf, -lag) + 1);
        cand = sp > 0 ? cal.shift(ls, sp) : ls;
      }
      lf = Math.min(lf, cand);
    }

    if (a.constraintDate) {
      const cd = isoToDay(a.constraintDate);
      if (a.constraintType === "FNLT") lf = Math.min(lf, cal.prevWork(cd));
      if (a.constraintType === "SNLT") lf = Math.min(lf, cal.shift(cal.prevWork(cd), sp));
    }

    s0.lf = lf;
    s0.ls = sp > 0 ? cal.shift(lf, -sp) : lf;
  }

  // --------------------------------------------------------------------- output
  const out: Record<string, CpmActivityResult> = {};
  for (const id of order) {
    const a = acts.get(id)!;
    const s = st.get(id)!;
    const cal = calOf(a);
    const totalFloat = s.complete && a.actualFinish ? 0 : cal.workDaysBetween(s.ef, s.lf);
    out[id] = {
      earlyStart: dayToIso(s.es),
      earlyFinish: dayToIso(s.ef),
      lateStart: dayToIso(s.ls),
      lateFinish: dayToIso(s.lf),
      totalFloat,
      isCritical: !s.complete && totalFloat <= 0,
      remainingDays: s.complete ? 0 : s.remaining,
    };
  }
  return { ok: true, cycleIds: [], activities: out, projectStart: dayToIso(projStart), projectFinish: dayToIso(projFinish) };
}
