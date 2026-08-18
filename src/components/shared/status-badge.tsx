import { Badge } from "@/components/ui/badge";

const projectStatusStyle: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "outline" | "gray" | "destructive" }> = {
  // Tendering statuses
  UNDER_STUDY: { label: "Under Study", variant: "gray" },
  SUBMITTED: { label: "Submitted", variant: "secondary" },
  APOLOGIZED: { label: "Apologized", variant: "outline" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  // Execution statuses
  IN_PROGRESS: { label: "In Progress", variant: "success" },
  ON_HOLD: { label: "On Hold", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "secondary" },
  ARCHIVED: { label: "Archived", variant: "outline" },
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const s = projectStatusStyle[status] ?? { label: status, variant: "gray" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const projectStageStyle: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "outline" | "gray" }> = {
  TENDERING: { label: "Tendering", variant: "warning" },
  EXECUTION: { label: "In Execution", variant: "success" },
};

export function ProjectStageBadge({ stage }: { stage: string }) {
  const s = projectStageStyle[stage] ?? { label: stage, variant: "gray" as const };
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
