import { z } from "zod";

export const companySettingsSchema = z.object({
  name: z.string().min(1),
  logoUrl: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  timezone: z.string().default("Africa/Cairo"),
  language: z.string().default("en"),
  dateFormat: z.string().default("DD/MM/YYYY"),
  currency: z.string().default("EGP"),
  theme: z.string().default("light"),
  defaultRevisionFormat: z.string().default("Rev. 00"),
  autoSave: z.boolean().default(true),
});

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
