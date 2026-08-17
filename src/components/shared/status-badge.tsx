import { Badge } from "@/components/ui/badge";

const projectStatusStyle: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "outline" | "gray" }> = {
  DRAFT: { label: "Draft", variant: "gray" },
  ACTIVE: { label: "Active", variant: "success" },
  ON_HOLD: { label: "On Hold", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "secondary" },
  ARCHIVED: { label: "Archived", variant: "outline" },
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const s = projectStatusStyle[status] ?? { label: status, variant: "gray" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const roleStyle: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "outline" | "gray" }> = {
  ADMIN: { label: "Admin", variant: "warning" },
  MANAGER: { label: "Manager", variant: "success" },
  ENGINEER: { label: "Engineer", variant: "secondary" },
  VIEWER: { label: "Viewer", variant: "gray" },
};

export function RoleBadge({ role }: { role: string }) {
  const s = roleStyle[role] ?? { label: role, variant: "gray" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Inactive</Badge>;
}
