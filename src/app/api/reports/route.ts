import { NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { prisma } from "@/server/db/client";

export async function GET() {
  const { res } = await requirePermission("reports.view");
  if (res) return res;

  const [projects, customers, documents, activity] = await Promise.all([
    prisma.project.findMany({ include: { customer: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.customer.findMany({ include: { _count: { select: { projects: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.document.findMany({ include: { project: { select: { name: true, number: true } }, uploadedBy: { select: { name: true } } }, orderBy: { uploadDate: "desc" } }),
    prisma.activityLog.findMany({ include: { user: { select: { name: true, role: true } } }, orderBy: { timestamp: "desc" }, take: 200 }),
  ]);

  return NextResponse.json({ projects, customers, documents, activity });
}
