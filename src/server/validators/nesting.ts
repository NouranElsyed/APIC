import { z } from "zod";

<<<<<<< HEAD
// Scrap & Material pricing inputs (PROJECT.md — Scrap & Material Calculation
// spec). These are the ONLY values a user may enter manually; everything
// else is derived from the Nesting Engine's actual results.
export const scrapPricingInputsSchema = z.object({
  nestingRunId: z.string().min(1),
  costPerKg: z.number().nonnegative(),
  usedLaterPct: z.number().min(0).max(1),
  usedLaterPriceLEPerKg: z.number().nonnegative(),
  scrapSellPriceLEPerKg: z.number().nonnegative(),
  // Optional per material+thickness-group overrides, keyed by "material||thicknessMm".
  overridesByGroupKey: z
    .record(
      z.string(),
      z.object({
        costPerKg: z.number().nonnegative().optional(),
        usedLaterPct: z.number().min(0).max(1).optional(),
        usedLaterPriceLEPerKg: z.number().nonnegative().optional(),
        scrapSellPriceLEPerKg: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
});
export type ScrapPricingInput = z.infer<typeof scrapPricingInputsSchema>;

=======
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
export const nestingJobSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Job name is required"),
  material: z.string().max(120).optional().nullable(),
  thicknessMm: z.number().positive().optional().nullable(),
});
export type NestingJobInput = z.infer<typeof nestingJobSchema>;

// A Source Sheet is a purchasable material/thickness/size, never a fixed
// quantity (PROJECT.md §2/§4) — availableQty is optional, informational
// stock-on-hand only, and is never required from the user or read by the
// nesting engine as a hard limit.
export const nestingSourceSchema = z.object({
  material: z.string().min(1, "Material is required").max(120),
  thicknessMm: z.number().positive("Thickness must be greater than 0"),
  widthMm: z.number().positive("Width must be greater than 0"),
  lengthMm: z.number().positive("Length must be greater than 0"),
  availableQty: z.number().int().positive().optional().nullable(),
});
export type NestingSourceInput = z.infer<typeof nestingSourceSchema>;

// Optional per-run overrides for the nesting engine's configurable part
// gap and per-side sheet margins (PROJECT.md §5/§6/§7). All are optional —
// omitted fields fall back to DEFAULT_ENGINE_CONFIG in nesting-engine.ts.
// Margins cannot be negative; validating them against a specific sheet's
// dimensions happens in the UI (PROJECT.md §20) since a run can nest
// across several different sheet sizes at once.
export const nestingRunConfigSchema = z.object({
  partGapMm: z.number().min(0, "Part gap cannot be negative").optional(),
  marginLeftMm: z.number().min(0, "Margins cannot be negative").optional(),
  marginRightMm: z.number().min(0, "Margins cannot be negative").optional(),
  marginTopMm: z.number().min(0, "Margins cannot be negative").optional(),
  marginBottomMm: z.number().min(0, "Margins cannot be negative").optional(),
});
export type NestingRunConfigInput = z.infer<typeof nestingRunConfigSchema>;
