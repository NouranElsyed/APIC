import { prisma } from "@/server/db/client";
import type { NoticeInput } from "@/server/validators/notice";
import { logActivity } from "./activity-log.service";

export async function createNotice(data: NoticeInput, userId: string) {
  const notice = await prisma.notice.create({
    data: {
      title: data.title,
      description: data.description || null,
      noticeDate: new Date(data.noticeDate),
      projectId: data.projectId,
      createdById: userId,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "NOTICE", entityId: notice.id, detail: notice.title });
  return notice;
}

export async function deleteNotice(id: string, userId: string) {
  const notice = await prisma.notice.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "NOTICE", entityId: id, detail: notice.title });
  return notice;
}
