import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { ProjectsView } from "@/features/projects/projects-view";

export default async function ProjectsPage() {
  const session = await auth();
  const role = session?.user.role;

  return (
    <ProjectsView
      canCreate={can(role, "projects.create")}
      canEdit={can(role, "projects.edit")}
      canDelete={can(role, "projects.delete")}
    />
  );
}
