"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, File, FileSpreadsheet, FileText, FolderClosed, FolderOpen, FolderPlus, HardDrive, Home, LayoutGrid, List, MoreHorizontal, Pencil, PenLine, Search, Trash2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProjectIdentity } from "@/features/planning/project-header";
import { planApi } from "@/features/planning/api";
import { fmtLong } from "@/features/planning/gantt-chart";
import { cn } from "@/lib/utils";
import { buildTree, CATEGORY_LABEL, DEFAULT_FOLDERS, formatSize, inFolder, isDefaultFolder, KIND_LABEL, summarize, type FileKind, type TreeNode } from "./docs";
import { EditDocumentDialog, NewFolderDialog, UploadDocumentDialog } from "./doc-dialogs";
import type { DocDTO, ProjectDocumentsData } from "./dto";

// Full class strings so Tailwind keeps them.
const KIND: Record<FileKind, { badge: string; tile: string; Icon: typeof File }> = {
  pdf: { badge: "bg-red-500 text-white", tile: "bg-red-50 text-red-500", Icon: FileText },
  dwg: { badge: "bg-blue-600 text-white", tile: "bg-blue-50 text-blue-600", Icon: File },
  xls: { badge: "bg-green-600 text-white", tile: "bg-green-50 text-green-600", Icon: FileSpreadsheet },
  image: { badge: "bg-violet-500 text-white", tile: "bg-violet-50 text-violet-500", Icon: File },
  other: { badge: "bg-slate-500 text-white", tile: "bg-slate-100 text-slate-500", Icon: File },
};

type SortKey = "date" | "name" | "size";

function Tree({ nodes, selected, onSelect, depth = 0 }: { nodes: TreeNode[]; selected: string | null; onSelect: (p: string) => void; depth?: number }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(DEFAULT_FOLDERS.filter((f) => !f.includes("/"))));
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => {
        const isOpen = open.has(n.path) || (selected != null && selected.startsWith(`${n.path}/`));
        const active = selected === n.path;
        return (
          <li key={n.path}>
            <div className={cn("flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm", active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-secondary")} style={{ paddingLeft: 8 + depth * 16 }}>
              {n.children.length > 0
                ? <button type="button" aria-label={isOpen ? "Collapse" : "Expand"} onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x; })} className="text-muted-foreground">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
                : <span className="w-3.5" />}
              <button type="button" onClick={() => onSelect(n.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {active || isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <FolderClosed className="h-4 w-4 shrink-0 text-amber-500" />}
                <span className="truncate">{n.name}</span><span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">({n.count})</span>
              </button>
            </div>
            {isOpen && n.children.length > 0 && <Tree nodes={n.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

function KindBadge({ kind }: { kind: FileKind }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", KIND[kind].badge)}>{KIND_LABEL[kind]}</span>;
}

function Thumb({ doc, className }: { doc: DocDTO; className?: string }) {
  const { tile, Icon } = KIND[doc.kind];
  if (doc.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={doc.url} alt={doc.title} loading="lazy" className={cn("w-full rounded-lg object-cover", className)} />;
  }
  return <div className={cn("flex w-full items-center justify-center rounded-lg", tile, className)}><Icon className="h-10 w-10" /></div>;
}

export function ProjectDocumentsView({ projectId, project, tabs, data, canCreate, canDelete }: {
  projectId: string; project: { name: string; number: string }; tabs: React.ReactNode; data: ProjectDocumentsData; canCreate: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState<"" | FileKind>("");
  const [section, setSection] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("date");
  const [layout, setLayout] = React.useState<"grid" | "list">("grid");
  const [folder, setFolder] = React.useState<string | null>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [folderDlg, setFolderDlg] = React.useState(false);
  const [editing, setEditing] = React.useState<DocDTO | null>(null);
  const [toDelete, setToDelete] = React.useState<DocDTO | null>(null);
  const [folderToDelete, setFolderToDelete] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const docs = data.documents;
  const sum = summarize(docs);
  const tree = React.useMemo(() => buildTree(docs.map((d) => d.folder), data.customFolders), [docs, data.customFolders]);
  const allFolders = React.useMemo(() => {
    const out: string[] = [];
    const walk = (ns: TreeNode[]) => ns.forEach((n) => { out.push(n.path); walk(n.children); });
    walk(tree);
    return out;
  }, [tree]);
  const sections = tree.map((n) => n.path);

  const visible = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = docs.filter((d) =>
      (!folder || inFolder(d.folder, folder)) && (!section || inFolder(d.folder, section)) && (!kind || (kind === "other" ? d.kind === "other" || d.kind === "image" : d.kind === kind)) &&
      (!term || [d.title, d.fileName, d.revision, d.uploadedBy].some((x) => x.toLowerCase().includes(term))));
    return [...list].sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : sort === "size" ? (b.size ?? 0) - (a.size ?? 0) : b.uploadDate.localeCompare(a.uploadDate));
  }, [docs, q, kind, section, sort, folder]);
  const preview = docs.find((d) => d.id === previewId) ?? null;

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    const r = await planApi(`/api/documents/${toDelete.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Document deleted");
    if (previewId === toDelete.id) setPreviewId(null);
    setToDelete(null);
    router.refresh();
  }
  async function removeFolder() {
    if (!folderToDelete) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/document-folders?path=${encodeURIComponent(folderToDelete)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Folder deleted");
    if (folder && inFolder(folder, folderToDelete)) setFolder(null);
    setFolderToDelete(null);
    router.refresh();
  }

  const stat = (icon: React.ReactNode, tint: string, label: string, value: React.ReactNode, extra?: React.ReactNode) => (
    <Card><CardContent className="flex items-center gap-3 p-4"><span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tint)}>{icon}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-muted-foreground">{label}</p><p className="text-xl font-semibold tracking-tight">{value}</p>{extra}</div></CardContent></Card>
  );
  const pct = data.storageLimit ? Math.min(100, (sum.bytes / data.storageLimit) * 100) : null;
  const actions = (d: DocDTO) => (
    <div className="flex items-center gap-1.5">
      <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Preview" onClick={() => setPreviewId(d.id)}><Eye className="h-4 w-4" /></Button>
      <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Download" asChild><a href={d.url} download={d.fileName} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /></a></Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-8 w-8" aria-label="More"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><a href={d.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open in new tab</a></DropdownMenuItem>
          {canCreate && <DropdownMenuItem onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /> Edit / move</DropdownMenuItem>}
          {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(d)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_repeat(2,minmax(0,1fr))_repeat(4,minmax(0,0.7fr))]">
        <div className="sm:col-span-2 xl:col-span-1"><ProjectIdentity name={project.name} number={project.number} /></div>
        {stat(<FileText className="h-5 w-5 text-primary" />, "bg-primary/10", "Total Documents", sum.total)}
        {stat(<HardDrive className="h-5 w-5 text-primary" />, "bg-primary/10", "Storage Used", <>{formatSize(sum.bytes)}{data.storageLimit && <span className="text-sm font-normal text-muted-foreground"> / {formatSize(data.storageLimit)}</span>}</>,
          pct != null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>)}
        {(["pdf", "dwg", "xls", "other"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(kind === k ? "" : k)} className="text-left">
            <Card className={cn("h-full", kind === k && "ring-2 ring-primary/40")}><CardContent className="flex items-center gap-3 p-4"><span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", KIND[k].tile)}>{React.createElement(KIND[k].Icon, { className: "h-5 w-5" })}</span><div><p className="text-xs font-medium text-muted-foreground">{KIND_LABEL[k]}</p><p className="text-xl font-semibold">{sum[k]}</p></div></CardContent></Card>
          </button>
        ))}
      </div>
      {tabs}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        {canCreate && <Button onClick={() => setUploadOpen(true)}><UploadCloud className="h-4 w-4" /> Upload Document</Button>}
        {canCreate && <Button variant="outline" onClick={() => setFolderDlg(true)}><FolderPlus className="h-4 w-4 text-primary" /> New Folder</Button>}
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-sm"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium shadow-sm" value={kind} onChange={(e) => setKind(e.target.value as FileKind | "")}>
          <option value="">All Types</option><option value="pdf">PDF</option><option value="dwg">DWG</option><option value="xls">XLS</option><option value="other">Other</option>
        </select>
        <select className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium shadow-sm" value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="">All Sections</option>{sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium shadow-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="date">Sort by: Date</option><option value="name">Sort by: Name</option><option value="size">Sort by: Size</option>
        </select>
        <div className="inline-flex rounded-lg border border-input p-0.5">
          {([["grid", LayoutGrid], ["list", List]] as const).map(([id, Icon]) => <button key={id} type="button" aria-label={`${id} view`} onClick={() => setLayout(id)} className={cn("rounded-md p-1.5", layout === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" /></button>)}
        </div>
      </div>

      <div className={cn("grid gap-4", preview ? "xl:grid-cols-[250px_minmax(0,1fr)_360px]" : "xl:grid-cols-[250px_minmax(0,1fr)]")}>
        <Card className="self-start"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><FolderOpen className="h-4 w-4 text-primary" /> Project Folders</CardTitle></CardHeader><CardContent className="space-y-2">
          <button type="button" onClick={() => setFolder(null)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm", folder === null ? "bg-primary/10 font-semibold text-primary" : "hover:bg-secondary")}><Home className="h-4 w-4" /> All Documents <span className="ml-auto text-xs font-normal text-muted-foreground">({docs.length})</span></button>
          <Tree nodes={tree} selected={folder} onSelect={setFolder} />
          {folder && canDelete && !isDefaultFolder(folder) && <Button variant="ghost" size="sm" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => setFolderToDelete(folder)}><Trash2 className="h-4 w-4" /> Delete “{folder.split("/").pop()}”</Button>}
        </CardContent></Card>

        <div className="min-w-0">
          {docs.length === 0 ? (
            <EmptyState icon={<FileText />} title="No documents yet" description={canCreate ? "Upload drawings, calculations, purchase orders and reports, and keep them in folders." : undefined} />
          ) : visible.length === 0 ? (
            <EmptyState icon={<Search />} title="No documents match" description="Try another folder or clear the filters." />
          ) : layout === "grid" ? (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {visible.map((d) => (
                <Card key={d.id} className={cn("overflow-hidden", d.id === previewId && "ring-2 ring-primary/40")}><CardContent className="space-y-3 p-3">
                  <div className="relative"><Thumb doc={d} className="h-32" /><span className="absolute left-2 top-2"><KindBadge kind={d.kind} /></span></div>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold" title={d.title}>{d.title}</p><p className="truncate text-xs text-muted-foreground">{fmtLong(d.uploadDate.slice(0, 10))} · {formatSize(d.size)}</p></div>
                  {actions(d)}
                </CardContent></Card>
              ))}
            </div>
          ) : (
            <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-border bg-secondary/60 text-left text-xs font-semibold"><th className="px-4 py-2.5">Name</th><th className="px-3 py-2.5">Folder</th><th className="px-3 py-2.5">Rev.</th><th className="px-3 py-2.5">Uploaded</th><th className="px-3 py-2.5 text-right">Size</th><th className="px-3 py-2.5" /></tr></thead>
              <tbody>{visible.map((d) => (
                <tr key={d.id} className={cn("border-b border-border/60 hover:bg-secondary/30", d.id === previewId && "bg-primary/5")}>
                  <td className="px-4 py-2.5"><div className="flex items-center gap-2"><KindBadge kind={d.kind} /><span className="truncate font-medium">{d.title}</span></div></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{d.folder}</td><td className="px-3 py-2.5">{d.revision}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{fmtLong(d.uploadDate.slice(0, 10))} · {d.uploadedBy}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatSize(d.size)}</td><td className="px-3 py-2.5">{actions(d)}</td>
                </tr>
              ))}</tbody>
            </table></div></Card>
          )}
          {docs.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Showing {visible.length} of {docs.length} document{docs.length === 1 ? "" : "s"}.</p>}
        </div>

        {preview && (
          <Card className="self-start"><CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Eye className="h-4 w-4 text-primary" /> Preview</CardTitle><button type="button" aria-label="Close preview" className="text-muted-foreground hover:text-foreground" onClick={() => setPreviewId(null)}><X className="h-4 w-4" /></button></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3"><span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", KIND[preview.kind].tile)}>{React.createElement(KIND[preview.kind].Icon, { className: "h-5 w-5" })}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold" title={preview.title}>{preview.title}</p><p className="truncate text-xs text-muted-foreground">{KIND_LABEL[preview.kind]} · {formatSize(preview.size)} · {fmtLong(preview.uploadDate.slice(0, 10))}</p></div>
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Download" asChild><a href={preview.url} download={preview.fileName} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /></a></Button>
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Open in new tab" asChild><a href={preview.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
              </div>
              {preview.kind === "pdf" ? <iframe title={preview.title} src={preview.url} className="h-[440px] w-full rounded-lg border border-border" />
                : preview.kind === "image" ? <Thumb doc={preview} className="max-h-[440px] !object-contain" />
                : <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center"><Thumb doc={preview} className="h-20 w-20 !w-20" /><p className="text-sm font-medium">No inline preview for {KIND_LABEL[preview.kind]} files</p><p className="text-xs text-muted-foreground">Download it to open in {preview.kind === "dwg" ? "AutoCAD or a DWG viewer" : preview.kind === "xls" ? "Excel" : "its own app"}.</p></div>}
              <dl className="divide-y divide-border/60 text-xs">
                {([["Folder", preview.folder], ["Category", CATEGORY_LABEL[preview.category]], ["Revision", preview.revision], ["File", preview.fileName], ["Uploaded by", preview.uploadedBy]] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="truncate text-right font-medium" title={v}>{v}</dd></div>)}
              </dl>
              {canCreate && <Button variant="outline" size="sm" className="w-full" onClick={() => setEditing(preview)}><PenLine className="h-4 w-4" /> Edit / move</Button>}
            </CardContent></Card>
        )}
      </div>

      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} projectId={projectId} folders={allFolders} defaultFolder={folder ?? "Others"} />
      <NewFolderDialog open={folderDlg} onOpenChange={setFolderDlg} projectId={projectId} parent={folder} />
      {editing && <EditDocumentDialog open onOpenChange={(o) => !o && setEditing(null)} doc={editing} folders={allFolders} />}
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete document?" description={toDelete ? `“${toDelete.title}” will be permanently removed.` : undefined} onConfirm={remove} loading={busy} />
      <ConfirmDialog open={!!folderToDelete} onOpenChange={(o) => !o && setFolderToDelete(null)} title="Delete folder?" description={folderToDelete ? `The empty folder “${folderToDelete}” will be removed.` : undefined} onConfirm={removeFolder} loading={busy} />
    </div>
  );
}
