import { prisma } from "@/server/db/client";
import type { CompanySettingsInput } from "@/server/validators/settings";
import { logActivity } from "./activity-log.service";

export async function getSettings() {
  let settings = await prisma.companySettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.companySettings.create({ data: { id: 1 } });
  }
  return settings;
}

export async function updateSettings(data: CompanySettingsInput, userId: string) {
  const settings = await prisma.companySettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  await logActivity({ userId, action: "UPDATE", entity: "SETTINGS", entityId: "1", detail: "Company settings updated" });
  return settings;
}

export async function listProjectStatuses() {
  return prisma.projectStatusConfig.findMany({ orderBy: { sortOrder: "asc" } });
}
