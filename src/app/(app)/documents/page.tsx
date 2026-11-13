import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { prisma } from "@/server/db/client";

/** Sidebar "Documents": open the most recently updated project's documents.
 *  The flat list across all projects is still available at /documents/all. */
export default async function DocumentsIndexPage() {
  const session = await auth();
  if (!can(session?.user.role, "documents.view")) notFound();
  const withDocs = await prisma.project.findFirst({ where: { documents: { some: {} } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const target = withDocs ?? (await prisma.project.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true } }));
  redirect(target ? `/projects/${target.id}/documents` : "/documents/all");
}
