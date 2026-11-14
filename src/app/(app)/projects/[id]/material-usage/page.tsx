import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getMaterialUsage } from "@/server/services/material-usage.service";
import { MaterialUsageView } from "@/features/material-usage/material-usage-view";
import { ProjectTabs } from "@/features/planning/project-tabs";

export default async function ProjectMaterialUsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "takeoff.view")) notFound();
  const data = await getMaterialUsage(id, { planning: can(role, "planning.view") });
  if (!data) notFound();
  const canCost = can(role, "quotations.view");

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${data.project.id}`} className="max-w-[240px] truncate hover:text-foreground">{data.project.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">Material &amp; Usage</span>
      </nav>
      <MaterialUsageView
        data={data}
        canCost={canCost}
        tabs={<ProjectTabs projectId={data.project.id} showPlanning={can(role, "planning.view")} showQuotations={canCost} />}
      />
    </div>
  );
}
