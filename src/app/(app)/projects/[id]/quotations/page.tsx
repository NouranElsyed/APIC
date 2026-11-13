import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getProject } from "@/server/services/project.service";
import { getQuotationsData } from "@/server/services/quotations.service";
import { QuotationsView } from "@/features/quotations/quotations-view";
import { ProjectTabs } from "@/features/planning/project-tabs";

export default async function ProjectQuotationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "quotations.view")) notFound();
  const [project, data] = await Promise.all([getProject(id), getQuotationsData(id)]);
  if (!project) notFound();

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${project.id}`} className="max-w-[240px] truncate hover:text-foreground">{project.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">Quotations</span>
      </nav>
      <QuotationsView
        projectId={project.id}
        project={{ name: project.name, number: project.number }}
        tabs={<ProjectTabs projectId={project.id} showPlanning={can(role, "planning.view")} showQuotations />}
        data={data}
        canEdit={can(role, "quotations.edit")}
        canDelete={can(role, "quotations.delete")}
      />
    </div>
  );
}
