import { z } from "zod";

export const projectStageEnum = z.enum(["TENDERING", "EXECUTION"]);

export const projectStatusEnum = z.enum([
  // Tendering stage
  "UNDER_STUDY",
  "SUBMITTED",
  "APOLOGIZED",
  "CANCELLED",
  // Execution stage
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
]);

export const TENDERING_STATUSES = ["UNDER_STUDY", "SUBMITTED", "APOLOGIZED", "CANCELLED"] as const;
export const EXECUTION_STATUSES = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "ARCHIVED"] as const;

export const projectSchema = z
  .object({
    number: z.string().min(2, "Project number is required"),
    name: z.string().min(2, "Project name is required"),
    customerId: z.string().min(1, "Client is required"),
    description: z.string().optional().nullable(),
    stage: projectStageEnum.default("TENDERING"),
    status: projectStatusEnum.default("UNDER_STUDY"),
    revision: z.string().default("Rev. 00"),
    dueDate: z.string().optional().nullable(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.stage === "TENDERING") {
      if (!(TENDERING_STATUSES as readonly string[]).includes(data.status)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Invalid status for a tendering project" });
      }
      if (!data.dueDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dueDate"], message: "Due date is required while a project is in tendering" });
      }
    } else {
      if (!(EXECUTION_STATUSES as readonly string[]).includes(data.status)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Invalid status for a project in execution" });
      }
    }
  });

export type ProjectInput = z.infer<typeof projectSchema>;

// "Convert to execution": the options the user can change before the project goes to execution.
export const convertExecutionSchema = z.object({
  /** first day of the schedule; defaults to the project's start date, then today */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").optional(),
  /** starting-guess durations (working days) of the BOQ activities; edited later in Planning */
  supplyDays: z.number().finite().min(1).max(365).default(14),
  installDays: z.number().finite().min(1).max(365).default(10),
  /** how the nest's sheets are ordered in Materials */
  materialUnit: z.enum(["sheet", "kg"]).default("sheet"),
  /** the user saw the "approximate parts" warning and still wants to convert */
  acceptApproximate: z.boolean().default(false),
});

export type ConvertExecutionInput = z.infer<typeof convertExecutionSchema>;
