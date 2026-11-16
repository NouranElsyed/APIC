import { z } from "zod";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  contactName: text(120),
  phone: text(40),
  email: z.string().trim().max(160).optional().nullable().refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), "Enter a valid email").transform((v) => (v ? v : null)),
  address: text(300),
  notes: text(1000),
  active: z.boolean().optional(),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const purchaseOrderSchema = z.object({
  projectId: z.string().min(1),
  supplierId: z.string().min(1, "Choose a supplier"),
  orderDate: iso,
  expectedDate: iso.optional().nullable(),
  currency: z.string().trim().min(3).max(3).default("EGP"),
  paymentTerms: text(1500),
  notes: text(1000),
  lines: z
    .array(z.object({ materialId: z.string().min(1), qty: z.number().finite().positive().max(1e9), unitPrice: z.number().finite().min(0).max(1e9).nullable().optional() }))
    .min(1, "Add at least one line")
    .max(200),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

/** Editing an order before anything is received: header fields + the lines to keep (by order-line id). */
export const purchaseOrderUpdateSchema = z.object({
  supplierId: z.string().min(1, "Choose a supplier"),
  orderDate: iso,
  expectedDate: iso.optional().nullable(),
  paymentTerms: text(1500),
  notes: text(1000),
  // an existing line is sent with its `id`; a line added while editing is a project material (`materialId`) or a new free item (`custom`)
  lines: z
    .array(
      z
        .object({ id: z.string().min(1).optional(), materialId: z.string().min(1).optional(), custom: z.object({ description: z.string().trim().min(2, "Describe the item").max(200), spec: text(200), unit: z.string().trim().min(1).max(20) }).optional(), qty: z.number().finite().positive().max(1e9), unitPrice: z.number().finite().min(0).max(1e9).nullable().optional() })
        .refine((l) => [l.id, l.materialId, l.custom].filter(Boolean).length === 1, "A line is an existing line, a project material, or a new item"),
    )
    .min(1, "An order needs at least one line (cancel the order instead)")
    .max(200),
});
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>;

export const receiptSchema = z.object({
  receivedDate: iso,
  deliveryNote: text(80),
  notes: text(1000),
  lines: z
    .array(
      z.object({
        orderId: z.string().min(1),
        qty: z.number().finite().positive().max(1e9),
        accepted: z.boolean().default(true),
        heatNo: text(60),
        certificateRef: text(80),
        notes: text(300),
      }),
    )
    .min(1, "Enter the received quantity of at least one line")
    .max(200),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

const dim = z.number().finite().positive().max(100000);

export const stockCreateSchema = z.object({
  kind: z.enum(["SHEET", "REMNANT"]).default("REMNANT"),
  material: z.string().trim().max(40).default(""),
  thicknessMm: z.number().finite().positive().max(500),
  widthMm: dim,
  heightMm: dim,
  qty: z.number().int().min(1).max(100000).default(1),
  location: text(80),
  heatNo: text(60),
  notes: text(300),
});
export type StockCreateInput = z.infer<typeof stockCreateSchema>;

export const stockAdjustSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, "Enter a quantity other than zero"),
  reason: z.enum(["ADDED", "USED", "SCRAPPED", "ADJUSTED"]),
  projectId: z.string().min(1).optional().nullable(),
  note: text(300),
});
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;

export const stockFromNestSchema = z.object({
  projectId: z.string().min(1).optional().nullable(),
  location: text(80),
  items: z
    .array(z.object({ thicknessMm: z.number().finite().positive().max(500), material: z.string().trim().max(40).default(""), widthMm: dim, heightMm: dim, qty: z.number().int().min(1).max(10000) }))
    .min(1, "Nothing to register")
    .max(200),
});
export type StockFromNestInput = z.infer<typeof stockFromNestSchema>;
