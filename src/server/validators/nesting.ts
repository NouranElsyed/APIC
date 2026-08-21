import { z } from "zod";

export const nestingJobSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Job name is required"),
  material: z.string().max(120).optional().nullable(),
  thicknessMm: z.number().positive().optional().nullable(),
});
export type NestingJobInput = z.infer<typeof nestingJobSchema>;

export const nestingSourceSchema = z.object({
  material: z.string().min(1, "Material is required").max(120),
  thicknessMm: z.number().positive("Thickness must be greater than 0"),
  widthMm: z.number().positive("Width must be greater than 0"),
  lengthMm: z.number().positive("Length must be greater than 0"),
  availableQty: z.number().int().positive("Available quantity must be at least 1"),
});
export type NestingSourceInput = z.infer<typeof nestingSourceSchema>;

// Optional per-run overrides for the nesting engine's configurable
// clearances (PROJECT.md §8). Both are optional — omitted fields fall back
// to DEFAULT_ENGINE_CONFIG in nesting-engine.ts.
export const nestingRunConfigSchema = z.object({
  edgeClearanceMm: z.number().min(0).optional(),
  partGapMm: z.number().min(0).optional(),
});
export type NestingRunConfigInput = z.infer<typeof nestingRunConfigSchema>;
