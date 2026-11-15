import { z } from "zod";

export const partGroupSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  code: z.string().trim().min(1, "Code is required").max(60),
  name: z.string().trim().min(1, "Name is required").max(200),
  dwgNo: z.string().trim().max(60).optional().nullable(),
  // without a parent: number of assemblies; with a parent: number per parent assembly
  qty: z.number().int().nonnegative().default(1),
  remark: z.string().trim().max(500).optional().nullable(),
  parentId: z.string().min(1).optional().nullable(),
});
export type PartGroupInput = z.infer<typeof partGroupSchema>;

// Move parts into a group (groupId null = take them out). qtyPerAssembly applies to every part sent.
export const assignPartsSchema = z.object({
  projectId: z.string().min(1),
  groupId: z.string().min(1).nullable(),
  partIds: z.array(z.string().min(1)).min(1, "Select at least one part").max(500),
  qtyPerAssembly: z.number().int().positive().optional(),
});
export type AssignPartsInput = z.infer<typeof assignPartsSchema>;
