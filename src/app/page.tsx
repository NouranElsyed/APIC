<<<<<<< HEAD
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { DocumentsView } from "@/features/documents/documents-view";

export default async function DocumentsPage() {
  const session = await auth();
  const role = session?.user.role;
  return <DocumentsView canCreate={can(role, "documents.create")} canDelete={can(role, "documents.delete")} />;
=======
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";

export default async function RootPage() {
  const session = await auth();
  redirect(session ? "/dashboard" : "/login");
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
