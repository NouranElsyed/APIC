// Plain-JSON shapes passed from the server to the planning UI (dates are ISO yyyy-mm-dd strings).

import type { Alert, Kpis, MilestoneRow, PlanRow, SCurve, WbsProgress } from "./metrics";
import type { ActivityType, CalendarDef, RelType } from "./types";

export interface PlanPredecessorDTO {
  relId: string;
  activityId: string;
  type: RelType;
  lagDays: number;
}

export interface PlanActivityDTO {
  id: string;
  wbsId: string | null;
  calendarId: string | null;
  code: string;
  name: string;
  type: ActivityType;
  durationDays: number;
  remainingDays: number;
  percentComplete: number;
  actualStart: string | null;
  actualFinish: string | null;
  constraintType: string | null;
  constraintDate: string | null;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloat: number;
  isCritical: boolean;
  predecessors: PlanPredecessorDTO[];
}

export interface PlanWbsDTO { id: string; parentId: string | null; code: string; name: string; sortOrder: number }

export interface PlanningData {
  schedule: {
    id: string;
    name: string;
    startDate: string;
    dataDate: string;
    finishDate: string | null;
    source: string;
    calcError: string | null;
    defaultCalendarId: string | null;
  };
  calendars: (CalendarDef & { isDefault: boolean })[];
  wbs: PlanWbsDTO[];
  activities: PlanActivityDTO[];
  baseline: { id: string; name: string; createdAt: string } | null;
  rows: PlanRow[];
  kpis: Kpis;
  scurve: SCurve;
  wbsProgress: WbsProgress[];
  alerts: Alert[];
  milestones: MilestoneRow[];
  criticalPath: { id: string; code: string; name: string; duration: number; start: string; finish: string }[];
}
