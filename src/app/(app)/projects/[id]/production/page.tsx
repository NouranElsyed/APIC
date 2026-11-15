import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getProduction } from "@/server/services/production.service";
import { ProductionView } from "@/features/production/production-view";
import { ProjectTabs } from "@/features/planning/project-tabs";

export default async function ProjectProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "production.view")) notFound();
  const data = await getProduction(id);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${data.project.id}`} className="max-w-[240px] truncate hover:text-foreground">{data.project.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">Production</span>
      </nav>
      <ProjectTabs projectId={data.project.id} showPlanning={can(role, "planning.view")} showQuotations={can(role, "quotations.view")} />
      <ProductionView data={data} canEdit={can(role, "production.edit")} canUpdate={can(role, "production.update")} />
    </div>
  );
}
