// Shared types for the Planning module (pure — no Prisma / React imports so the
// CPM, XER and metrics code can be unit-tested in isolation).

export type ActivityType = "TASK" | "MILESTONE_START" | "MILESTONE_FINISH";
export type RelType = "FS" | "SS" | "FF" | "SF";

/** Calendar definition. `workDays[0]` is Sunday … `workDays[6]` is Saturday. */
export interface CalendarDef {
  id: string;
  name: string;
  workDays: boolean[];
  /** ISO dates (yyyy-mm-dd) that are non-working even if the weekday is a work day. */
  holidays: string[];
  /** ISO dates that are working even if the weekday / holiday says otherwise. */
  workExceptions: string[];
  hoursPerDay: number;
}

export interface ActivityInput {
  id: string;
  type: ActivityType;
  durationDays: number;
  remainingDays: number | null;
  percentComplete: number;
  actualStart: string | null; // ISO yyyy-mm-dd
  actualFinish: string | null;
  calendarId: string | null;
  /** SNET | SNLT | FNET | FNLT — anything else is stored but ignored by the calculation. */
  constraintType: string | null;
  constraintDate: string | null;
}

export interface RelInput {
  predecessorId: string;
  successorId: string;
  type: RelType;
  lagDays: number;
}

export interface CpmInput {
  activities: ActivityInput[];
  relationships: RelInput[];
  calendars: CalendarDef[];
  defaultCalendarId: string;
  projectStart: string;
  dataDate: string;
}

export interface CpmActivityResult {
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  /** Total float in working days of the activity's calendar. */
  totalFloat: number;
  isCritical: boolean;
  remainingDays: number;
}

export interface CpmResult {
  ok: boolean;
  /** Ids of activities that sit on a logic loop (when ok = false). */
  cycleIds: string[];
  activities: Record<string, CpmActivityResult>;
  projectStart: string | null;
  projectFinish: string | null;
}
