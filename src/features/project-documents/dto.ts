import type { Category, FileKind } from "./docs";

export interface DocDTO {
  id: string; title: string; category: Category; revision: string; fileName: string; url: string;
  size: number | null; uploadDate: string; uploadedBy: string; folder: string; kind: FileKind;
}
export interface ProjectDocumentsData {
  documents: DocDTO[];
  customFolders: string[];
  /** Optional storage quota in bytes (set DOCUMENT_STORAGE_LIMIT_MB to show a usage bar). */
  storageLimit: number | null;
}
