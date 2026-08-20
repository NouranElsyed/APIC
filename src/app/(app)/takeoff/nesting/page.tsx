import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { NestingView } from "@/features/nesting/nesting-view";

export default async function NestingPage() {
  const session = await auth();
  const role = session?.user.role;
  return (
    <NestingView
      canCreate={can(role, "nesting.create")}
      canDelete={can(role, "nesting.delete")}
    />
  );
}
