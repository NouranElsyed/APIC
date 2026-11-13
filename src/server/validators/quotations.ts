import { z } from "zod";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const money = z.number().finite().min(0).max(1e12);

export const quotationItemSchema = z.object({
  description: z.string().trim().min(1, "Item description is required").max(250),
  material: z.string().trim().max(80).nullable().optional(),
  qty: money,
  unit: z.string().trim().min(1).max(20).default("kg"),
  unitRate: money,
  type: z.enum(["SUPPLY", "INSTALL"]).default("SUPPLY"),
});

export const quotationSchema = z.object({
  section: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(1, "Description is required").max(250),
  currency: z.string().trim().min(1).max(6).optional(),
  issueDate: iso.optional(),
  validUntil: iso.nullable().optional(),
  profitMargin: z.number().finite().min(-100).max(1000).nullable().optional(),
  preparedBy: z.string().trim().max(120).nullable().optional(),
  terms: z.string().max(10000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(quotationItemSchema).max(2000).optional(),
});

export const quotationPatchSchema = quotationSchema.partial();

export const statusSchema = z.object({
  status: z.enum(["DRAFT", "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]),
  note: z.string().trim().max(500).optional(),
});

export type QuotationInput = z.infer<typeof quotationSchema>;
export type QuotationPatch = z.infer<typeof quotationPatchSchema>;
export type QuotationItemInput = z.infer<typeof quotationItemSchema>;
