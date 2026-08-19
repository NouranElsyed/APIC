import { z } from "zod";

export const documentCategoryEnum = z.enum([
  "DRAWING", "SPECIFICATION", "CONTRACT", "PURCHASE_ORDER", "TECHNICAL_DOCUMENT", "EMAIL", "OTHER",
]);

export const documentSchema = z.object({
  title: z.string().min(2, "Title is required"),
  category: documentCategoryEnum.default("OTHER"),
  projectId: z.string().min(1, "Project is required"),
  revision: z.string().default("Rev. 00"),
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  fileSize: z.number().optional(),
});

export type DocumentInput = z.infer<typeof documentSchema>;
