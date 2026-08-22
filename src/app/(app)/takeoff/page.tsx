import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
<<<<<<< HEAD
import { NestingView } from "@/features/nesting/nesting-view";

export default async function NestingPage() {
  const session = await auth();
  const role = session?.user.role;
  return (
    <NestingView
      canCreate={can(role, "nesting.create")}
      canDelete={can(role, "nesting.delete")}
=======
import { TakeoffView } from "@/features/takeoff/takeoff-view";

export default async function TakeoffPage() {
  const session = await auth();
  const role = session?.user.role;
  return (
    <TakeoffView
      canCreate={can(role, "takeoff.create")}
      canDelete={can(role, "takeoff.delete")}
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
    />
  );
}
