import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getExecutionPreflight } from "@/server/services/execution.service";
import { ExecutionView } from "@/features/execution/execution-view";
import { ProjectTabs } from "@/features/planning/project-tabs";

export default async function ProjectExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "projects.view")) notFound();
  const data = await getExecutionPreflight(id);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${data.project.id}`} className="max-w-[240px] truncate hover:text-foreground">{data.project.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">Execution</span>
      </nav>
      <ExecutionView
        data={data}
        canConvert={can(role, "projects.edit") && can(role, "planning.edit")}
        tabs={<ProjectTabs projectId={data.project.id} showPlanning={can(role, "planning.view")} showQuotations={can(role, "quotations.view")} />}
      />
    </div>
  );
}
