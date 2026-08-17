export interface DocumentRow {
  id: string;
  title: string;
  category: string;
  revision: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  uploadDate: string;
  project: { name: string; number: string };
  uploadedBy: { name: string };
}
