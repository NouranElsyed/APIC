import { z } from "zod";

export const noticeSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string().optional().nullable(),
  noticeDate: z.string().min(1, "Date is required"),
  projectId: z.string().min(1, "Project is required"),
});

export type NoticeInput = z.infer<typeof noticeSchema>;
