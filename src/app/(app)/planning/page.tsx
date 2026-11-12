import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { prisma } from "@/server/db/client";

/** Sidebar "Planning": jump to the most recently updated project that has a schedule (else any project). */
export default async function PlanningIndexPage() {
  const session = await auth();
  if (!can(session?.user.role, "planning.view")) notFound();
  const withSchedule = await prisma.project.findFirst({ where: { planSchedule: { isNot: null } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const target = withSchedule ?? (await prisma.project.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true } }));
  redirect(target ? `/projects/${target.id}/planning` : "/projects");
}
