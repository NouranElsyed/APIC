"use client";
import * as React from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Pencil, Trash2, Eye, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { SearchBar } from "@/components/shared/search-bar";
import { FilterPanel } from "@/components/shared/filter-panel";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/utils";
import { ProjectForm } from "./project-form";
import type { ProjectRow, CustomerOption } from "./types";
import { toast } from "sonner";

const STATUS_OPTIONS = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => ({
  value: s, label: s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
}));

export function ProjectsView({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const [projects, setProjects] = React.useState<ProjectRow[]>([]);
  const [customers, setCustomers] = React.useState<CustomerOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = React.useState<ProjectRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [pRes, cRes] = await Promise.all([fetch("/api/projects"), fetch("/api/customers")]);
    setProjects(await pRes.json());
    setCustomers(await cRes.json());
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = projects.filter((p) => {
    const matchesSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.number.toLowerCase().includes(search.toLowerCase()) ||
      p.customer.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !filters.status || filters.status === "ALL" || p.status === filters.status;
    return matchesSearch && matchesStatus;
  });

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/projects/${deleting.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete project"); return; }
    toast.success("Project deleted");
    setDeleting(null);
    load();
  }

  const columns: ColumnDef<ProjectRow, any>[] = [
    {
      accessorKey: "number",
      header: "Project #",
      cell: ({ row }) => (
        <Link href={`/projects/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.number}
        </Link>
      ),
    },
    { accessorKey: "name", header: "Name" },
    { accessorKey: "customer.name", header: "Customer", cell: ({ row }) => row.original.customer.name },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <ProjectStatusBadge status={row.original.status} /> },
    { accessorKey: "revision", header: "Revision" },
    { accessorKey: "startDate", header: "Start", cell: ({ row }) => formatDate(row.original.startDate) },
    { accessorKey: "endDate", header: "End", cell: ({ row }) => formatDate(row.original.endDate) },
    { accessorKey: "createdBy.name", header: "Created By", cell: ({ row }) => row.original.createdBy.name },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/projects/${row.original.id}`}><Eye className="h-4 w-4" /> View</Link>
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem onClick={() => { setEditing(row.original); setFormOpen(true); }}>
                <Pencil className="h-4 w-4" /> Edit
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem onClick={() => setDeleting(row.original)} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search projects, customers…" />
          <FilterPanel
            filters={[{ key: "status", label: "Status", options: STATUS_OPTIONS }]}
            values={filters}
            onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
          />
        </div>
        {canCreate && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading projects…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects found" description="Create your first project to get started." />
      ) : (
        <DataTable columns={columns} data={filtered} pageSize={10} />
      )}

      <ProjectForm open={formOpen} onOpenChange={setFormOpen} customers={customers} project={editing} onSaved={load} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this project?"
        description={`"${deleting?.name}" and its linked documents will be permanently removed.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
