import { z } from "zod";

export const takeoffDrawingSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  drawingNumber: z.string().min(1, "Drawing number is required"),
  title: z.string().min(1, "Title is required"),
  weightFromDwg: z.number().nonnegative().optional().nullable(),
});
export type TakeoffDrawingInput = z.infer<typeof takeoffDrawingSchema>;

const commonFields = {
  drawingId: z.string().min(1),
  itemNo: z.number().int().nonnegative(),
  description: z.string().min(1, "Description is required"),
  // Per-part material — the authoritative material for THIS part. Optional
  // because existing rows predate this field; a part with no material is
  // treated as "Missing material" by the nesting grouping logic, never
  // silently inherited from anything else.
  material: z.string().trim().min(1).optional().nullable(),
  side: z.enum(["INTERNAL", "EXTERNAL"]).default("EXTERNAL"),
  qty: z.number().int().positive(),
  paintSides: z.union([z.literal(1), z.literal(2)]).default(2),
  buyWeightKg: z.number().nonnegative().optional().nullable(),
};

const plateSchema = z.object({
  ...commonFields,
  partType: z.literal("PLATE"),
  thicknessMm: z.number().positive("Thickness is required"),
  geometry: z.object({
    width: z.number().positive("Width is required"),
    length: z.number().positive("Length is required"),
    cutoffFormula: z.string().max(200).optional().nullable(),
  }),
  areaFormula: z.string().max(300).optional().nullable(),
});

const coneSchema = z.object({
  ...commonFields,
  partType: z.literal("CONE"),
  thicknessMm: z.number().positive("Thickness is required"),
  geometry: z.object({
    d1: z.number().positive("D1 is required"),
    d2: z.number().positive("D2 is required"),
    height: z.number().positive("Height is required"),
  }),
  areaFormula: z.string().max(300).optional().nullable(),
});

const pipeSchema = z.object({
  ...commonFields,
  partType: z.literal("PIPE"),
  thicknessMm: z.number().positive("Thickness is required"),
  geometry: z.object({
    od: z.number().positive("OD is required"),
    length: z.number().positive("Length is required"),
  }),
  areaFormula: z.string().max(300).optional().nullable(),
});

const hotRolledSchema = z.object({
  ...commonFields,
  partType: z.literal("HOT_ROLLED"),
  thicknessMm: z.number().positive().optional().nullable(),
  geometry: z.object({
    profile: z.string().min(1, "Profile is required"),
    length: z.number().positive("Length is required"),
    weightPerMeter: z.number().positive("Weight per metre is required"),
    paintAreaPerMeter: z.number().nonnegative().optional().nullable(),
  }),
  areaFormula: z.string().optional().nullable(),
});

export const takeoffPartSchema = z.discriminatedUnion("partType", [
  plateSchema,
  coneSchema,
  pipeSchema,
  hotRolledSchema,
]);
export type TakeoffPartInputData = z.infer<typeof takeoffPartSchema>;
