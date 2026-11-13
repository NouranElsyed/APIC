import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { DocumentsView } from "@/features/documents/documents-view";

export default async function AllDocumentsPage() {
  const session = await auth();
  const role = session?.user.role;
  return <DocumentsView canCreate={can(role, "documents.create")} canDelete={can(role, "documents.delete")} />;
}
