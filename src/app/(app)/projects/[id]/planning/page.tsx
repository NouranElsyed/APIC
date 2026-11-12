import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getProject } from "@/server/services/project.service";
import { getPlanningData } from "@/server/services/planning.service";
import { getMaterialsData } from "@/server/services/materials.service";
import { PlanningView } from "@/features/planning/planning-view";
import { ProjectTabs } from "@/features/planning/project-tabs";
import { ProjectHeader } from "@/features/planning/project-header";

export default async function ProjectPlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!can(session?.user.role, "planning.view")) notFound();
  const [project, data, materials] = await Promise.all([getProject(id), getPlanningData(id), getMaterialsData(id)]);
  if (!project) notFound();

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${project.id}`} className="max-w-[240px] truncate hover:text-foreground">{project.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">Planning</span>
      </nav>
      <ProjectHeader name={project.name} number={project.number} kpis={data?.kpis ?? null} />
      <ProjectTabs projectId={project.id} />
      <PlanningView
        projectId={project.id}
        projectLabel={`${project.number} — ${project.name}`}
        data={data}
        materials={materials}
        canEdit={can(session?.user.role, "planning.edit")}
        canDelete={can(session?.user.role, "planning.delete")}
        defaultName={`${project.name} — Schedule`}
        defaultStart={project.startDate ? project.startDate.toISOString().slice(0, 10) : null}
      />
    </div>
  );
}
