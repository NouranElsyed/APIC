import { z } from "zod";
import { STAGES } from "@/features/production/production";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const createWorkOrdersSchema = z.object({
  /** omit = every part that has no work order yet */
  partIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
  dueDate: iso.nullable().optional(),
});

export const advanceSchema = z.object({ stage: z.enum(STAGES), count: z.number().int().min(1).max(5000) });

export const pieceActionSchema = z.object({ stage: z.enum(STAGES), action: z.enum(["complete", "undo"]) });

export const productionLinkSchema = z.object({ wbsId: z.string().min(1).nullable() });
