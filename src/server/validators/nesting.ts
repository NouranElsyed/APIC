import { z } from "zod";

export const nestingJobSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Job name is required"),
  material: z.string().max(120).optional().nullable(),
  thicknessMm: z.number().positive().optional().nullable(),
});
export type NestingJobInput = z.infer<typeof nestingJobSchema>;

export const nestingJobItemSchema = z.object({
  takeoffPartId: z.string().min(1),
  qtyOverride: z.number().int().positive().optional().nullable(),
});
export type NestingJobItemInput = z.infer<typeof nestingJobItemSchema>;
