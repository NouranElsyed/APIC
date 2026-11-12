import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getProject } from "@/server/services/project.service";
import { getPlanningData } from "@/server/services/planning.service";
import { Button } from "@/components/ui/button";
import { ProjectStageBadge, ProjectStatusBadge } from "@/components/shared/status-badge";
import { PlanningView } from "@/features/planning/planning-view";
import { ProjectTabs } from "@/features/planning/project-tabs";

export default async function ProjectPlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!can(session?.user.role, "planning.view")) notFound();
  const [project, data] = await Promise.all([getProject(id), getPlanningData(id)]);
  if (!project) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link href="/projects"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
            <ProjectStageBadge stage={project.stage} />
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="text-xs text-muted-foreground">{project.number} · {project.revision}</p>
        </div>
      </div>
      <ProjectTabs projectId={project.id} />
      <PlanningView
        projectId={project.id}
        projectLabel={`${project.number} — ${project.name}`}
        data={data}
        canEdit={can(session?.user.role, "planning.edit")}
        canDelete={can(session?.user.role, "planning.delete")}
        defaultName={`${project.name} — Schedule`}
        defaultStart={project.startDate ? project.startDate.toISOString().slice(0, 10) : null}
      />
    </div>
  );
}
