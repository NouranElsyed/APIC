import { z } from "zod";

export const scopeItemSchema = z.object({
  description: z.string().min(2, "Description is required"),
  projectId: z.string().min(1, "Project is required"),
});

export type ScopeItemInput = z.infer<typeof scopeItemSchema>;
