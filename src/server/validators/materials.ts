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

export type MaterialInput = z.infer<typeof materialSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
