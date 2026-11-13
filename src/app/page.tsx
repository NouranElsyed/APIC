import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getProject } from "@/server/services/project.service";
import { getPlanningData } from "@/server/services/planning.service";
import { PrintSchedule } from "@/features/planning/print-schedule";

export default async function PrintPlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!can(session?.user.role, "planning.view")) notFound();
  const [project, data] = await Promise.all([getProject(id), getPlanningData(id)]);
  if (!project || !data) notFound();
  return <PrintSchedule data={data} title={`${project.number} — ${project.name}`} />;
}
