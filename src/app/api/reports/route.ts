import { NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { prisma } from "@/server/db/client";
import { totals } from "@/features/quotations/quotation";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function GET() {
  const { res } = await requirePermission("reports.view");
  if (res) return res;

  const [projects, customers, documents, activity, quotations, materials, schedules] = await Promise.all([
    prisma.project.findMany({ include: { customer: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.customer.findMany({ include: { _count: { select: { projects: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.document.findMany({ include: { project: { select: { name: true, number: true } }, uploadedBy: { select: { name: true } } }, orderBy: { uploadDate: "desc" } }),
    prisma.activityLog.findMany({ include: { user: { select: { name: true, role: true } } }, orderBy: { timestamp: "desc" }, take: 200 }),
    prisma.quotation.findMany({
      include: { project: { select: { number: true, name: true, customer: { select: { name: true } } } }, items: { select: { qty: true, unitRate: true, type: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.planMaterial.findMany({
      include: { project: { select: { number: true, name: true } }, orders: { select: { orderedQty: true, receivedQty: true, unitPrice: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.planSchedule.findMany({
      include: { project: { select: { number: true, name: true } }, activities: { select: { percentComplete: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Flat rows: the client can show and export them as they are.
  const quotationRows = quotations.map((q) => ({
    id: q.id,
    number: q.number,
    revision: q.revision,
    projectNumber: q.project.number,
    projectName: q.project.name,
    customer: q.project.customer.name,
    description: q.description,
    status: q.status,
    currency: q.currency,
    total: totals(q.items).grand,
    issueDate: iso(q.issueDate),
    validUntil: iso(q.validUntil),
    createdAt: q.createdAt.toISOString(),
  }));

  const materialRows = materials.map((m) => {
    const ordered = m.orders.reduce((s, o) => s + o.orderedQty, 0);
    const received = m.orders.reduce((s, o) => s + o.receivedQty, 0);
    const cost = m.orders.reduce((s, o) => s + o.orderedQty * (o.unitPrice ?? 0), 0);
    return {
      id: m.id,
      projectNumber: m.project.number,
      projectName: m.project.name,
      code: m.code ?? "",
      description: m.description,
      unit: m.unit,
      requiredQty: m.requiredQty,
      orderedQty: ordered,
      receivedQty: received,
      toOrderQty: Math.max(0, m.requiredQty - ordered),
      orderedCost: cost,
      neededBy: iso(m.neededBy),
      createdAt: m.createdAt.toISOString(),
    };
  });

  const scheduleRows = schedules.map((s) => {
    const n = s.activities.length;
    const avg = n ? s.activities.reduce((sum, a) => sum + a.percentComplete, 0) / n : 0;
    return {
      id: s.id,
      projectNumber: s.project.number,
      projectName: s.project.name,
      name: s.name,
      source: s.source,
      activities: n,
      percentComplete: Math.round(avg * 10) / 10,
      startDate: iso(s.startDate),
      dataDate: iso(s.dataDate),
      finishDate: iso(s.finishDate),
      createdAt: s.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ projects, customers, documents, activity, quotations: quotationRows, materials: materialRows, schedules: scheduleRows });
}
