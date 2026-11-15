import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { TakeoffView } from "@/features/takeoff/takeoff-view";

// Part List: the project's parts (plates, hot rolled, cones, pipes, accessories) grouped into BOQ assemblies.
// The project gate (choose a project first) is applied by the takeoff layout.
export default async function PartListPage() {
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "takeoff.view")) redirect("/");
  return <TakeoffView canCreate={can(role, "takeoff.create")} canDelete={can(role, "takeoff.delete")} />;
}
