import { z } from "zod";

export const roleEnum = z.enum(["ADMIN", "MANAGER", "ENGINEER", "VIEWER"]);

export const userCreateSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: roleEnum.default("VIEWER"),
  department: z.string().optional().nullable(),
  active: z.boolean().default(true),
});

export const userUpdateSchema = userCreateSchema.partial({ password: true });

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
