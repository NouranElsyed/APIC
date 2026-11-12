// Working-calendar arithmetic. Dates are handled as integer "day numbers"
// (days since 1970-01-01, UTC) so there are no timezone surprises.

import type { CalendarDef } from "./types";

const MS_DAY = 86_400_000;

export const isoToDay = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
};
export const dayToIso = (day: number): string => new Date(day * MS_DAY).toISOString().slice(0, 10);
export const dateToIso = (d: Date): string => d.toISOString().slice(0, 10);
export const isoToDate = (iso: string): Date => new Date(isoToDay(iso) * MS_DAY);
/** 0 = Sunday … 6 = Saturday */
export const dayOfWeek = (day: number): number => (((day + 4) % 7) + 7) % 7;

/** Default Egyptian work week: Sunday–Thursday, Friday & Saturday off, 8 h/day. */
export const DEFAULT_WORK_DAYS = [true, true, true, true, true, false, false];

export class WorkCalendar {
  private readonly workDays: boolean[];
  private readonly holidays: Set<number>;
  private readonly extra: Set<number>;
  readonly hoursPerDay: number;

  constructor(def: Pick<CalendarDef, "workDays" | "holidays" | "workExceptions" | "hoursPerDay">) {
    // A calendar with no working weekday would make every search loop forever → fall back to the default week.
    this.workDays = def.workDays.length === 7 && def.workDays.some(Boolean) ? def.workDays : DEFAULT_WORK_DAYS;
    this.holidays = new Set(def.holidays.map(isoToDay));
    this.extra = new Set(def.workExceptions.map(isoToDay));
    this.hoursPerDay = def.hoursPerDay > 0 ? def.hoursPerDay : 8;
  }

  isWork(day: number): boolean {
    if (this.extra.has(day)) return true;
    if (this.holidays.has(day)) return false;
    return this.workDays[dayOfWeek(day)];
  }

  /** First working day on or after `day`. */
  nextWork(day: number): number {
    let d = day;
    for (let i = 0; i < 4000 && !this.isWork(d); i++) d++;
    return d;
  }

  /** Last working day on or before `day`. */
  prevWork(day: number): number {
    let d = day;
    for (let i = 0; i < 4000 && !this.isWork(d); i++) d--;
    return d;
  }

  /** Move `n` working days forward (n > 0) or backward (n < 0) from `day`. */
  shift(day: number, n: number): number {
    const step = n >= 0 ? 1 : -1;
    let left = Math.round(Math.abs(n));
    let d = day;
    while (left > 0) {
      d += step;
      if (this.isWork(d)) left--;
    }
    return d;
  }

  /** Signed number of working days between `a` and `b` (b later → positive). */
  workDaysBetween(a: number, b: number): number {
    if (a === b) return 0;
    const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
    let n = 0;
    for (let d = lo + 1; d <= hi; d++) if (this.isWork(d)) n++;
    return n * sign;
  }
}
