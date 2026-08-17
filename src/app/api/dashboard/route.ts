import { NextResponse } from "next/server";
import { requireSession } from "@/server/api/guard";
import { prisma } from "@/server/db/client";
import { projectStats } from "@/server/services/project.service";
import { getRecentActivity } from "@/server/services/activity-log.service";

export async function GET() {
  const { res } = await requireSession();
  if (res) return res;

  const [stats, customers, documents, pendingReviews, users, recentActivity, monthly] = await Promise.all([
    projectStats(),
    prisma.customer.count(),
    prisma.document.count(),
    prisma.project.count({ where: { status: "DRAFT" } }),
    prisma.user.count(),
    getRecentActivity(8),
    prisma.project.findMany({ select: { createdAt: true } }),
  ]);

  // Monthly project activity (last 6 months, created counts)
  const now = new Date();
  const months: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("en-US", { month: "short" });
    const count = monthly.filter((p) => {
      const pd = new Date(p.createdAt);
      return pd.getFullYear() === d.getFullYear() && pd.getMonth() === d.getMonth();
    }).length;
    months.push({ month: label, count });
  }

  return NextResponse.json({
    stats: { ...stats, customers, documents, pendingReviews, users },
    recentActivity,
    monthlyActivity: months,
  });
}
