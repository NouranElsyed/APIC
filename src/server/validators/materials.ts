import { z } from "zod";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const qty = z.number().finite().min(0).max(1e12);

export const materialSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(200),
  code: z.string().trim().max(40).nullable().optional(),
  spec: z.string().trim().max(200).nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  requiredQty: qty,
  neededBy: iso.nullable().optional(),
  wbsId: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const orderSchema = z.object({
  supplier: z.string().trim().min(1, "Supplier is required").max(120),
  poNumber: z.string().trim().max(60).nullable().optional(),
  orderedQty: qty.refine((n) => n > 0, "Quantity must be greater than zero"),
  unitPrice: z.number().finite().min(0).max(1e12).nullable().optional(),
  orderDate: iso.nullable().optional(),
  expectedDate: iso.nullable().optional(),
  receivedQty: qty.optional(),
  receivedDate: iso.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// Material requests created from a nesting result (one line per stock sheet size / thickness / material).
export const nestMaterialsSchema = z.object({
  lines: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        description: z.string().trim().min(1).max(200),
        spec: z.string().trim().max(200).nullable().optional(),
        unit: z.enum(["sheet", "kg"]),
        requiredQty: z.number().finite().min(0).max(1e12),
        notes: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .min(1, "Nothing to send")
    .max(60),
});

export type MaterialInput = z.infer<typeof materialSchema>;
export type NestMaterialLine = z.infer<typeof nestMaterialsSchema>["lines"][number];
export type OrderInput = z.infer<typeof orderSchema>;
