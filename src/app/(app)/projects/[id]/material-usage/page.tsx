import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getMaterialRequirements } from "@/server/services/material-usage.service";
import { MaterialRequirementsView } from "@/features/material-usage/material-requirements-view";

export default async function ProjectMaterialRequirementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "takeoff.view")) notFound();
  const data = await getMaterialRequirements(id);
  if (!data) notFound();
  return <MaterialRequirementsView data={data} canOrder={can(role, "procurement.edit")} />;
}
