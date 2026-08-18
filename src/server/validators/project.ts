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
