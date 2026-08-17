"use client";
import * as React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Pencil, KeyRound, UserCog, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { SearchBar } from "@/components/shared/search-bar";
import { RoleBadge, ActiveBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials, formatDate } from "@/lib/utils";
import { UserForm } from "./user-form";
import { ResetPasswordDialog } from "./reset-password-dialog";
import type { UserRow } from "./types";
import { toast } from "sonner";

export function UsersView() {
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = React.useState<UserRow | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/users");
    setUsers(await res.json());
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  async function toggleActive(u: UserRow) {
    const res = await fetch(`/api/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !u.active }) });
    if (!res.ok) { toast.error("Failed to update status"); return; }
    toast.success(u.active ? "User deactivated" : "User activated");
    load();
  }

  const columns: ColumnDef<UserRow, any>[] = [
    {
      accessorKey: "name", header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7"><AvatarFallback>{initials(row.original.name)}</AvatarFallback></Avatar>
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "role", header: "Role", cell: ({ row }) => <RoleBadge role={row.original.role} /> },
    { accessorKey: "department", header: "Department", cell: ({ row }) => row.original.department || "—" },
    { accessorKey: "active", header: "Status", cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
    { accessorKey: "createdAt", header: "Joined", cell: ({ row }) => formatDate(row.original.createdAt) },
    {
      id: "actions", header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setEditing(row.original); setFormOpen(true); }}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setResetTarget(row.original)}><KeyRound className="h-4 w-4" /> Reset Password</DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleActive(row.original)}>
              <Power className="h-4 w-4" /> {row.original.active ? "Deactivate" : "Activate"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search users…" />
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-4 w-4" /> New User</Button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading users…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={UserCog} title="No users found" />
      ) : (
        <DataTable columns={columns} data={filtered} pageSize={10} />
      )}

      <UserForm open={formOpen} onOpenChange={setFormOpen} user={editing} onSaved={load} />
      <ResetPasswordDialog open={!!resetTarget} onOpenChange={(v) => !v && setResetTarget(null)} userId={resetTarget?.id ?? null} userName={resetTarget?.name} />
    </div>
  );
}
