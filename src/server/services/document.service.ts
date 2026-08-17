import { prisma } from "@/server/db/client";
import type { DocumentInput } from "@/server/validators/document";
import { logActivity } from "./activity-log.service";

export async function listDocuments() {
  return prisma.document.findMany({
    include: { project: { select: { name: true, number: true } }, uploadedBy: { select: { name: true } } },
    orderBy: { uploadDate: "desc" },
  });
}

export async function createDocument(data: DocumentInput, userId: string) {
  const doc = await prisma.document.create({
    data: {
      title: data.title,
      category: data.category,
      projectId: data.projectId,
      revision: data.revision,
      fileName: data.fileName,
      filePath: data.filePath,
      fileSize: data.fileSize,
      uploadedById: userId,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "DOCUMENT", entityId: doc.id, detail: doc.title });
  return doc;
}

export async function deleteDocument(id: string, userId: string) {
  const doc = await prisma.document.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "DOCUMENT", entityId: id, detail: doc.title });
  return doc;
}
