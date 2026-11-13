import { prisma } from "@/server/db/client";
import { PlanningError } from "./planning.service";
import { logActivity } from "./activity-log.service";
import { effectiveFolder, fileKind, inFolder, isDefaultFolder, normalizeFolderPath, type Category } from "@/features/project-documents/docs";
import type { ProjectDocumentsData } from "@/features/project-documents/dto";

export class DocumentsError extends PlanningError {}

export async function getProjectDocuments(projectId: string): Promise<ProjectDocumentsData> {
  const [docs, folders] = await Promise.all([
    prisma.document.findMany({ where: { projectId }, orderBy: { uploadDate: "desc" }, include: { uploadedBy: { select: { name: true } } } }),
    prisma.documentFolder.findMany({ where: { projectId }, orderBy: { path: "asc" }, select: { path: true } }),
  ]);
  const mb = Number(process.env.DOCUMENT_STORAGE_LIMIT_MB);
  return {
    documents: docs.map((d) => ({
      id: d.id, title: d.title, category: d.category as Category, revision: d.revision, fileName: d.fileName, url: d.filePath, size: d.fileSize,
      uploadDate: d.uploadDate.toISOString(), uploadedBy: d.uploadedBy.name, folder: effectiveFolder({ folder: d.folder, category: d.category as Category }), kind: fileKind(d.fileName),
    })),
    customFolders: folders.map((f) => f.path),
    storageLimit: Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : null,
  };
}

export async function createFolder(projectId: string, input: string, userId: string) {
  const norm = normalizeFolderPath(input);
  if (!norm.ok) throw new DocumentsError(norm.error);
  if (isDefaultFolder(norm.path)) throw new DocumentsError("That folder already exists.", 409);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new DocumentsError("Project not found", 404);
  const exists = await prisma.documentFolder.findUnique({ where: { projectId_path: { projectId, path: norm.path } } });
  if (exists) throw new DocumentsError("That folder already exists.", 409);
  await prisma.documentFolder.create({ data: { projectId, path: norm.path } });
  await logActivity({ userId, action: "CREATE", entity: "DOCUMENT", entityId: projectId, detail: `Folder ${norm.path}` });
  return norm.path;
}

/** Only folders the user created can be removed, and only when no document is inside them. */
export async function deleteFolder(projectId: string, path: string, userId: string) {
  if (isDefaultFolder(path)) throw new DocumentsError("The standard folders cannot be deleted.", 409);
  const docs = await prisma.document.findMany({ where: { projectId }, select: { folder: true, category: true } });
  if (docs.some((d) => inFolder(effectiveFolder({ folder: d.folder, category: d.category as Category }), path))) {
    throw new DocumentsError("Move or delete the documents in this folder first.", 409);
  }
  const res = await prisma.documentFolder.deleteMany({ where: { projectId, OR: [{ path }, { path: { startsWith: `${path}/` } }] } });
  if (res.count === 0) throw new DocumentsError("Folder not found", 404);
  await logActivity({ userId, action: "DELETE", entity: "DOCUMENT", entityId: projectId, detail: `Folder ${path}` });
}

export interface DocumentPatch { title?: string; folder?: string | null; category?: Category; revision?: string }

export async function updateDocument(id: string, patch: DocumentPatch, userId: string) {
  const doc = await prisma.document.findUnique({ where: { id }, select: { id: true, projectId: true, title: true } });
  if (!doc) throw new DocumentsError("Document not found", 404);
  let folder: string | null | undefined = undefined;
  if (patch.folder !== undefined) {
    if (patch.folder === null || patch.folder === "") folder = null;
    else {
      const norm = normalizeFolderPath(patch.folder);
      if (!norm.ok) throw new DocumentsError(norm.error);
      folder = norm.path;
      // Moving into a folder that does not exist yet creates it.
      if (!isDefaultFolder(folder)) await prisma.documentFolder.upsert({ where: { projectId_path: { projectId: doc.projectId, path: folder } }, create: { projectId: doc.projectId, path: folder }, update: {} });
    }
  }
  await prisma.document.update({ where: { id }, data: { title: patch.title, folder, category: patch.category, revision: patch.revision } });
  await logActivity({ userId, action: "UPDATE", entity: "DOCUMENT", entityId: id, detail: patch.title ?? doc.title });
}
