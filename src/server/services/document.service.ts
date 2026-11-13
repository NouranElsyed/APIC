import { prisma } from "@/server/db/client";
import type { DocumentInput } from "@/server/validators/document";
import { del } from "@vercel/blob";
import { logActivity } from "./activity-log.service";
import { normalizeFolderPath, isDefaultFolder } from "@/features/project-documents/docs";

export async function listDocuments() {
  return prisma.document.findMany({
    include: { project: { select: { name: true, number: true } }, uploadedBy: { select: { name: true } } },
    orderBy: { uploadDate: "desc" },
  });
}

export async function createDocument(data: DocumentInput, userId: string) {
  let folder: string | null = null;
  if (data.folder) {
    const norm = normalizeFolderPath(data.folder);
    if (norm.ok) {
      folder = norm.path;
      if (!isDefaultFolder(folder)) await prisma.documentFolder.upsert({ where: { projectId_path: { projectId: data.projectId, path: folder } }, create: { projectId: data.projectId, path: folder }, update: {} });
    }
  }
  const doc = await prisma.document.create({
    data: {
      folder,
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
  // Best effort: free the stored file too. The record is already gone, so a failure here is not fatal.
  if (/^https?:\/\//.test(doc.filePath)) await del(doc.filePath).catch(() => undefined);
  await logActivity({ userId, action: "DELETE", entity: "DOCUMENT", entityId: id, detail: doc.title });
  return doc;
}
