// Pure helpers for the project Documents screen (folders, file kinds, sizes, counts).

export type FileKind = "pdf" | "dwg" | "xls" | "image" | "other";
export type Category = "DRAWING" | "SPECIFICATION" | "CONTRACT" | "PURCHASE_ORDER" | "TECHNICAL_DOCUMENT" | "EMAIL" | "OTHER";

export const CATEGORY_LABEL: Record<Category, string> = {
  DRAWING: "Drawing", SPECIFICATION: "Specification", CONTRACT: "Contract", PURCHASE_ORDER: "Purchase Order",
  TECHNICAL_DOCUMENT: "Technical Document", EMAIL: "Mail", OTHER: "Other",
};

export const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", dwg: "DWG", xls: "XLS", image: "Image", other: "Other" };

export function fileKind(fileName: string): FileKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "dwg" || ext === "dxf") return "dwg";
  if (["xls", "xlsx", "xlsm", "csv"].includes(ext)) return "xls";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  return "other";
}

/** The standard tree. Users add their own folders on top of it. */
export const DEFAULT_FOLDERS = [
  "Engineering", "Engineering/Drawings", "Engineering/Calculations",
  "Procurement", "Procurement/Supplier Docs", "Procurement/Purchase Orders",
  "Fabrication", "Fabrication/Workshop Drawings", "Fabrication/WPS & QA",
  "Installation", "Installation/Site Drawings", "Installation/Reports",
  "Others",
];

/** Where a document without an explicit folder shows up. */
export function folderForCategory(c: Category): string {
  switch (c) {
    case "DRAWING": return "Engineering/Drawings";
    case "SPECIFICATION": return "Engineering";
    case "TECHNICAL_DOCUMENT": return "Engineering/Calculations";
    case "PURCHASE_ORDER": return "Procurement/Purchase Orders";
    default: return "Others";
  }
}
export const effectiveFolder = (d: { folder: string | null; category: Category }) => d.folder ?? folderForCategory(d.category);

export const inFolder = (docFolder: string, folder: string) => docFolder === folder || docFolder.startsWith(`${folder}/`);

export function normalizeFolderPath(input: string): { ok: true; path: string } | { ok: false; error: string } {
  const parts = input.split("/").map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "Enter a folder name." };
  if (parts.length > 3) return { ok: false, error: "Folders can be nested up to 3 levels." };
  for (const p of parts) {
    if (p.length > 40) return { ok: false, error: "A folder name can have up to 40 characters." };
    if (/[\u0000-\u001f\\]/.test(p)) return { ok: false, error: "A folder name cannot contain control characters or backslashes." };
  }
  return { ok: true, path: parts.join("/") };
}

export const isDefaultFolder = (path: string) => DEFAULT_FOLDERS.includes(path) || DEFAULT_FOLDERS.some((f) => f.startsWith(`${path}/`));

export interface TreeNode { path: string; name: string; count: number; custom: boolean; children: TreeNode[] }

/** Folder tree with document counts (a folder counts the documents of its sub-folders too). */
export function buildTree(docFolders: string[], customFolders: string[]): TreeNode[] {
  const all = new Set<string>(DEFAULT_FOLDERS);
  for (const p of [...customFolders, ...docFolders]) {
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join("/"));
  }
  const defaults = new Set(DEFAULT_FOLDERS);
  const nodes = new Map<string, TreeNode>();
  for (const path of all) nodes.set(path, { path, name: path.split("/").pop()!, count: docFolders.filter((f) => inFolder(f, path)).length, custom: !defaults.has(path), children: [] });
  const roots: TreeNode[] = [];
  const order = (p: string) => { const i = DEFAULT_FOLDERS.indexOf(p); return i < 0 ? 1000 : i; };
  for (const path of [...all].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const node = nodes.get(path)!;
    const parent = path.includes("/") ? nodes.get(path.slice(0, path.lastIndexOf("/"))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  // "Others" is always last at the top level.
  roots.sort((a, b) => Number(a.path === "Others") - Number(b.path === "Others"));
  return roots;
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(Math.round((bytes / 1024 ** 2) * 10) / 10).toString()} MB`;
  return `${(Math.round((bytes / 1024 ** 3) * 100) / 100).toString()} GB`;
}

export function summarize(docs: { kind: FileKind; size: number | null }[]) {
  const by = { pdf: 0, dwg: 0, xls: 0, other: 0 };
  let bytes = 0;
  for (const d of docs) {
    bytes += d.size ?? 0;
    if (d.kind === "pdf") by.pdf++; else if (d.kind === "dwg") by.dwg++; else if (d.kind === "xls") by.xls++; else by.other++;
  }
  return { total: docs.length, bytes, ...by };
}
