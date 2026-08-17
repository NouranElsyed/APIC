import { z } from "zod";

export const projectStatusEnum = z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]);

export const projectSchema = z.object({
  number: z.string().min(2, "Project number is required"),
  name: z.string().min(2, "Project name is required"),
  customerId: z.string().min(1, "Customer is required"),
  description: z.string().optional().nullable(),
  status: projectStatusEnum.default("DRAFT"),
  revision: z.string().default("Rev. 00"),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

export type ProjectInput = z.infer<typeof projectSchema>;
