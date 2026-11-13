import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { TakeoffView } from "@/features/takeoff/takeoff-view";

export default async function TakeoffPage() {
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "takeoff.view")) redirect("/dashboard");
  return <TakeoffView canCreate={can(role, "takeoff.create")} canDelete={can(role, "takeoff.delete")} />;
}
