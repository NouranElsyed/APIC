import { z } from "zod";

export const customerSchema = z.object({
  code: z.string().min(2, "Customer code is required"),
  name: z.string().min(2, "Company name is required"),
  contact: z.string().optional().nullable(),
  email: z.string().email("Invalid email").optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  taxNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type CustomerInput = z.infer<typeof customerSchema>;
