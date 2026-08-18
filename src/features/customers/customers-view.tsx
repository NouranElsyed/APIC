"use client";
import * as React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Pencil, Trash2, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { SearchBar } from "@/components/shared/search-bar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CustomerForm } from "./customer-form";
import type { CustomerRow } from "./types";
import { toast } from "sonner";

export function CustomersView({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const [customers, setCustomers] = React.useState<CustomerRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CustomerRow | null>(null);
  const [deleting, setDeleting] = React.useState<CustomerRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/customers");
    setCustomers(await res.json());
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = customers.filter((c) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    (c.contact ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/customers/${deleting.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete — customer may have linked projects"); return; }
    toast.success("Customer deleted");
    setDeleting(null);
    load();
  }

  const columns: ColumnDef<CustomerRow, any>[] = [
    { accessorKey: "code", header: "Code", cell: ({ row }) => <Badge variant="outline">{row.original.code}</Badge> },
    { accessorKey: "name", header: "Company Name" },
    { accessorKey: "contact", header: "Contact", cell: ({ row }) => row.original.contact || "—" },
    { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || "—" },
    { accessorKey: "phone", header: "Phone", cell: ({ row }) => row.original.phone || "—" },
    { accessorKey: "_count.projects", header: "Projects", cell: ({ row }) => row.original._count?.projects ?? 0 },
    {
      id: "actions", header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && <DropdownMenuItem onClick={() => { setEditing(row.original); setFormOpen(true); }}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem onClick={() => setDeleting(row.original)} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search customers…" />
        {canCreate && <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-4 w-4" /> New Customer</Button>}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading customers…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users2 className="h-5 w-5" />} title="No customers found" description="Add your first customer to get started." />
      ) : (
        <DataTable columns={columns} data={filtered} pageSize={10} />
      )}

      <CustomerForm open={formOpen} onOpenChange={setFormOpen} customer={editing} onSaved={load} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this customer?"
        description={`"${deleting?.name}" will be permanently removed.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
