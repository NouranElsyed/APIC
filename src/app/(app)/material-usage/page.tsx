import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { prisma } from "@/server/db/client";

/** Sidebar "Material & Usage": jump to the most recently updated project's material usage. */
export default async function MaterialUsageIndexPage() {
  const session = await auth();
  if (!can(session?.user.role, "takeoff.view")) notFound();
  const target = await prisma.project.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true } });
  redirect(target ? `/projects/${target.id}/material-usage` : "/projects");
}
