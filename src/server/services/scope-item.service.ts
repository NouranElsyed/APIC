import { prisma } from "@/server/db/client";
import type { ScopeItemInput } from "@/server/validators/scope-item";
import { logActivity } from "./activity-log.service";

export async function createScopeItem(data: ScopeItemInput, userId: string) {
  const item = await prisma.scopeItem.create({
    data: {
      description: data.description,
      projectId: data.projectId,
      createdById: userId,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "SCOPE_ITEM", entityId: item.id, detail: item.description });
  return item;
}

export async function deleteScopeItem(id: string, userId: string) {
  const item = await prisma.scopeItem.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "SCOPE_ITEM", entityId: id, detail: item.description });
  return item;
}
