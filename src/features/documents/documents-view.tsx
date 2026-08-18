"use client";
import * as React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Trash2, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { SearchBar } from "@/components/shared/search-bar";
import { FilterPanel } from "@/components/shared/filter-panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/utils";
import { UploadForm } from "./upload-form";
import type { DocumentRow } from "./types";
import { toast } from "sonner";

const CATEGORY_OPTIONS = [
  "DRAWING", "SPECIFICATION", "CONTRACT", "PURCHASE_ORDER", "TECHNICAL_DOCUMENT", "OTHER",
].map((c) => ({ value: c, label: c.replace("_", " ").replace(/\b\w/g, (ch) => ch.toUpperCase()) }));

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function DocumentsView({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
  const [documents, setDocuments] = React.useState<DocumentRow[]>([]);
  const [projects, setProjects] = React.useState<{ id: string; name: string; number: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<DocumentRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [dRes, pRes] = await Promise.all([fetch("/api/documents"), fetch("/api/projects")]);
    setDocuments(await dRes.json());
    setProjects(await pRes.json());
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = documents.filter((d) => {
    const matchesSearch = !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.project.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !filters.category || filters.category === "ALL" || d.category === filters.category;
    return matchesSearch && matchesCategory;
  });

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/documents/${deleting.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete document"); return; }
    toast.success("Document deleted");
    setDeleting(null);
    load();
  }

  const columns: ColumnDef<DocumentRow, any>[] = [
    { accessorKey: "title", header: "Title" },
    { accessorKey: "category", header: "Category", cell: ({ row }) => <Badge variant="secondary">{row.original.category.replace("_", " ")}</Badge> },
    { accessorKey: "project.name", header: "Project", cell: ({ row }) => `${row.original.project.number} — ${row.original.project.name}` },
    { accessorKey: "revision", header: "Revision" },
    { accessorKey: "fileSize", header: "Size", cell: ({ row }) => formatBytes(row.original.fileSize) },
    { accessorKey: "uploadedBy.name", header: "Uploaded By", cell: ({ row }) => row.original.uploadedBy.name },
    { accessorKey: "uploadDate", header: "Date", cell: ({ row }) => formatDate(row.original.uploadDate) },
    {
      id: "actions", header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={row.original.filePath} download target="_blank" rel="noreferrer"><Download className="h-4 w-4" /> Download</a>
            </DropdownMenuItem>
            {canDelete && <DropdownMenuItem onClick={() => setDeleting(row.original)} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search documents…" />
          <FilterPanel filters={[{ key: "category", label: "Category", options: CATEGORY_OPTIONS }]} values={filters} onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))} />
        </div>
        {canCreate && <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> Upload Document</Button>}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading documents…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents found" description="Upload a document to attach it to a project." />
      ) : (
        <DataTable columns={columns} data={filtered} pageSize={10} />
      )}

      <UploadForm open={formOpen} onOpenChange={setFormOpen} projects={projects} onSaved={load} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this document?"
        description={`"${deleting?.title}" will be permanently removed.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
