import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { prisma } from "@/server/db/client";

/** Sidebar "Quotations": open the most recently updated project's quotations. */
export default async function QuotationsIndexPage() {
  const session = await auth();
  if (!can(session?.user.role, "quotations.view")) notFound();
  const withQuotes = await prisma.project.findFirst({ where: { quotations: { some: {} } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const target = withQuotes ?? (await prisma.project.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true } }));
  redirect(target ? `/projects/${target.id}/quotations` : "/projects");
}
