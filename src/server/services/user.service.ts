import { prisma } from "@/server/db/client";
import bcrypt from "bcryptjs";
import type { UserCreateInput, UserUpdateInput } from "@/server/validators/user";
import { logActivity } from "./activity-log.service";

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, role: true, department: true, active: true, createdAt: true },
  });
}

export async function createUser(data: UserCreateInput, actorId: string) {
  const hashed = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: hashed,
      role: data.role,
      department: data.department || null,
      active: data.active,
    },
  });
  await logActivity({ userId: actorId, action: "CREATE", entity: "USER", entityId: user.id, detail: user.email });
  return user;
}

export async function updateUser(id: string, data: UserUpdateInput, actorId: string) {
  const user = await prisma.user.update({
    where: { id },
    data: {
      name: data.name,
      email: data.email,
      role: data.role,
      department: data.department || null,
      active: data.active,
      ...(data.password ? { password: await bcrypt.hash(data.password, 10) } : {}),
    },
  });
  await logActivity({ userId: actorId, action: "UPDATE", entity: "USER", entityId: user.id, detail: user.email });
  return user;
}

export async function toggleUserActive(id: string, active: boolean, actorId: string) {
  const user = await prisma.user.update({ where: { id }, data: { active } });
  await logActivity({
    userId: actorId,
    action: active ? "ACTIVATE" : "DEACTIVATE",
    entity: "USER",
    entityId: user.id,
    detail: user.email,
  });
  return user;
}

export async function resetUserPassword(id: string, newPassword: string, actorId: string) {
  const hashed = await bcrypt.hash(newPassword, 10);
  const user = await prisma.user.update({ where: { id }, data: { password: hashed } });
  await logActivity({ userId: actorId, action: "RESET_PASSWORD", entity: "USER", entityId: user.id, detail: user.email });
  return user;
}
