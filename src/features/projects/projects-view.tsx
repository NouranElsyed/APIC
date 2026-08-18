"use client";
import * as React from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Pencil, Trash2, Eye, FolderKanban, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { SearchBar } from "@/components/shared/search-bar";
import { FilterPanel } from "@/components/shared/filter-panel";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/utils";
import { ProjectForm } from "./project-form";
import type { ProjectRow, CustomerOption } from "./types";
import { toast } from "sonner";

const TENDER_STATUS_OPTIONS = ["UNDER_STUDY", "SUBMITTED", "APOLOGIZED", "CANCELLED"].map((s) => ({
  value: s, label: s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
}));
const EXECUTION_STATUS_OPTIONS = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => ({
  value: s, label: s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
}));

function ContactInfoCell({ customer }: { customer: ProjectRow["customer"] }) {
  if (!customer.email && !customer.phone) {
    return <span className="text-xs text-muted-foreground">No contact on file</span>;
  }
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {customer.contact && <div className="font-medium text-foreground">{customer.contact}</div>}
      {customer.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{customer.email}</div>}
      {customer.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{customer.phone}</div>}
    </div>
  );
}

export function ProjectsView({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const [projects, setProjects] = React.useState<ProjectRow[]>([]);
  const [customers, setCustomers] = React.useState<CustomerOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<"EXECUTION" | "TENDERING">("EXECUTION");
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

  const byStage = projects.filter((p) => p.stage === tab);
  const statusOptions = tab === "TENDERING" ? TENDER_STATUS_OPTIONS : EXECUTION_STATUS_OPTIONS;

  const filtered = byStage.filter((p) => {
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
    { accessorKey: "customer.name", header: "Client", cell: ({ row }) => row.original.customer.name },
    { id: "contact", header: "Contact Info", cell: ({ row }) => <ContactInfoCell customer={row.original.customer} /> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <ProjectStatusBadge status={row.original.status} /> },
    { accessorKey: "revision", header: "Revision" },
    ...(tab === "TENDERING"
      ? [{ accessorKey: "dueDate", header: "Due Date", cell: ({ row }: any) => formatDate(row.original.dueDate) } as ColumnDef<ProjectRow, any>]
      : [
          { accessorKey: "startDate", header: "Start", cell: ({ row }: any) => formatDate(row.original.startDate) } as ColumnDef<ProjectRow, any>,
          { accessorKey: "endDate", header: "End", cell: ({ row }: any) => formatDate(row.original.endDate) } as ColumnDef<ProjectRow, any>,
        ]),
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
      <Tabs value={tab} onValueChange={(v) => { setTab(v as "EXECUTION" | "TENDERING"); setFilters({}); }}>
        <TabsList>
          <TabsTrigger value="EXECUTION">In Hand Projects</TabsTrigger>
          <TabsTrigger value="TENDERING">Tendering</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search projects, clients…" />
          <FilterPanel
            filters={[{ key: "status", label: "Status", options: statusOptions }]}
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
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title={tab === "TENDERING" ? "No tendering projects" : "No in-hand projects"}
          description={tab === "TENDERING" ? "Projects being tendered will show up here." : "Create your first project to get started."}
        />
      ) : (
        <DataTable columns={columns} data={filtered} pageSize={10} />
      )}

      <ProjectForm open={formOpen} onOpenChange={setFormOpen} customers={customers} project={editing} onSaved={load} defaultStage={tab} />
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
