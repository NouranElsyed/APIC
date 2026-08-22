import { z } from "zod";

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

// Scrap & Material pricing inputs (PROJECT.md — Scrap & Material Calculation
// spec). These are the ONLY values a user may enter manually; everything
// else is derived from the Nesting Engine's actual results.
const scrapPricingGroupOverrideSchema = z.object({
  costPerKg: z.number().min(0, "Cost per kg cannot be negative").optional(),
  usedLaterPct: z.number().min(0).max(1, "Used-later % must be between 0 and 1").optional(),
  usedLaterPriceLEPerKg: z.number().min(0, "Price cannot be negative").optional(),
  scrapSellPriceLEPerKg: z.number().min(0, "Price cannot be negative").optional(),
});

export const scrapPricingInputsSchema = z.object({
  nestingRunId: z.string().min(1),
  costPerKg: z.number().min(0, "Cost per kg cannot be negative"),
  usedLaterPct: z.number().min(0).max(1, "Used-later % must be between 0 and 1"),
  usedLaterPriceLEPerKg: z.number().min(0, "Price cannot be negative"),
  scrapSellPriceLEPerKg: z.number().min(0, "Price cannot be negative"),
  overridesByGroupKey: z.record(z.string(), scrapPricingGroupOverrideSchema).optional(),
});
export type ScrapPricingInputs = z.infer<typeof scrapPricingInputsSchema>;
