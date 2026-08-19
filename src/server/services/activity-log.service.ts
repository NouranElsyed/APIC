import { prisma } from "@/server/db/client";

export async function logActivity(params: {
  userId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "ACTIVATE" | "DEACTIVATE" | "RESET_PASSWORD";
  entity: "PROJECT" | "CUSTOMER" | "DOCUMENT" | "USER" | "SETTINGS" | "TAKEOFF_DRAWING" | "TAKEOFF_PART" | "SCOPE_ITEM" | "NOTICE" | "MEETING_MINUTE";
  entityId?: string;
  detail?: string;
}) {
  return prisma.activityLog.create({ data: params });
}

export async function getRecentActivity(take = 8) {
  return prisma.activityLog.findMany({
    orderBy: { timestamp: "desc" },
    take,
    include: { user: { select: { name: true, role: true } } },
  });
}
