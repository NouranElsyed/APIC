import { z } from "zod";

export const takeoffDrawingSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  drawingNumber: z.string().min(1, "Drawing number is required"),
  title: z.string().min(1, "Title is required"),
  weightFromDwg: z.number().nonnegative().optional().nullable(),
});
export type TakeoffDrawingInput = z.infer<typeof takeoffDrawingSchema>;

export const takeoffPartSchema = z.object({
  drawingId: z.string().min(1),
  itemNo: z.number().int().nonnegative(),
  description: z.string().min(1, "Description is required"),
  extWidth: z.number().nonnegative().optional().nullable(),
  extLength: z.number().nonnegative().optional().nullable(),
  intWidth: z.number().nonnegative().optional().nullable(),
  intLength: z.number().nonnegative().optional().nullable(),
  qty: z.number().int().positive(),
  thicknessMm: z.number().positive(),
  paintSides: z.union([z.literal(1), z.literal(2)]).default(2),
  areaMode: z.enum(["ADD", "SUBTRACT"]).default("ADD"),
});
export type TakeoffPartInputData = z.infer<typeof takeoffPartSchema>;

// Grid entry: same row shape, minus drawingId (supplied once for the whole batch).
export const takeoffPartGridRowSchema = takeoffPartSchema.omit({ drawingId: true });
export type TakeoffPartGridRow = z.infer<typeof takeoffPartGridRowSchema>;

export const takeoffPartBulkSchema = z.object({
  drawingId: z.string().min(1),
  rows: z.array(takeoffPartGridRowSchema).min(1, "Add at least one row"),
});
export type TakeoffPartBulkInput = z.infer<typeof takeoffPartBulkSchema>;
