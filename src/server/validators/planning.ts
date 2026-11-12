import { z } from "zod";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const relType = z.enum(["FS", "SS", "FF", "SF"]);
const days = z.number().finite();

export const workDaysSchema = z.array(z.boolean()).length(7).refine((a) => a.some(Boolean), "At least one working day is required");

export const createScheduleSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  startDate: iso,
  workDays: workDaysSchema.optional(),
  starterWbs: z.boolean().optional(),
});

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  startDate: iso.optional(),
  dataDate: iso.optional(),
  calendar: z
    .object({
      workDays: workDaysSchema,
      holidays: z.array(iso).max(500),
      hoursPerDay: z.number().min(1).max(24),
    })
    .optional(),
});

export const predecessorSchema = z.object({
  activityId: z.string().min(1),
  type: relType,
  lagDays: days.min(-3650).max(3650),
});

export const activitySchema = z.object({
  wbsId: z.string().nullable().optional(),
  code: z.string().trim().min(1).max(30).optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(["TASK", "MILESTONE_START", "MILESTONE_FINISH"]).optional(),
  durationDays: days.min(0).max(36500).optional(),
  calendarId: z.string().nullable().optional(),
  percentComplete: days.min(0).max(100).optional(),
  actualStart: iso.nullable().optional(),
  actualFinish: iso.nullable().optional(),
  remainingDays: days.min(0).nullable().optional(),
  constraintType: z.enum(["SNET", "SNLT", "FNET", "FNLT"]).nullable().optional(),
  constraintDate: iso.nullable().optional(),
  predecessors: z.array(predecessorSchema).max(200).optional(),
});

export const wbsSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(30),
  name: z.string().trim().min(1, "Name is required").max(160),
  parentId: z.string().nullable().optional(),
});

export const progressSchema = z.object({
  dataDate: iso.optional(),
  updates: z
    .array(
      z.object({
        activityId: z.string().min(1),
        percentComplete: days.min(0).max(100).optional(),
        actualStart: iso.nullable().optional(),
        actualFinish: iso.nullable().optional(),
        remainingDays: days.min(0).nullable().optional(),
      }),
    )
    .max(5000),
});

export const baselineSchema = z.object({ name: z.string().trim().min(1).max(80).optional() });

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type ActivityInput = z.infer<typeof activitySchema>;
export type WbsInput = z.infer<typeof wbsSchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
