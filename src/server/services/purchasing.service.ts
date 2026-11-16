// Purchase orders (grouping material order lines per supplier) and goods receipts (heat / certificate traceability).

import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError } from "./planning.service";
import { dateToIso, isoToDate } from "@/features/planning/calendar";
import { docNumber, nextSequence, poState, poTotal, remainingToOrder, validatePoLines, validateReceipt, type PoState } from "@/features/procurement/procurement";
import type { PurchaseOrderInput, PurchaseOrderUpdateInput, ReceiptInput } from "@/server/validators/procurement";

const i2 = (d: Date | null | undefined) => (d ? dateToIso(d) : null);
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
type Actor = { id: string; name: string };

export interface PoLineDTO { id: string; materialId: string; code: string | null; description: string; spec: string | null; unit: string; orderedQty: number; receivedQty: number; unitPrice: number | null }
export interface PurchaseOrderDTO {
  id: string; number: string; state: PoState; currency: string;
  supplier: { id: string; name: string }; project: { id: string; number: string; name: string };
  orderDate: string; expectedDate: string | null; paymentTerms: string | null; notes: string | null; createdByName: string;
  total: number; lines: PoLineDTO[]; receipts: number;
}

const poInclude = {
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, number: true, name: true } },
  lines: { include: { material: { select: { id: true, code: true, description: true, spec: true, unit: true } } }, orderBy: { createdAt: "asc" as const } },
  _count: { select: { receipts: true } },
};
type PoRow = Awaited<ReturnType<typeof loadPo>>;
const loadPo = (id: string) => prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude });

function toDto(p: NonNullable<PoRow>): PurchaseOrderDTO {
  const lines: PoLineDTO[] = p.lines.map((l) => ({ id: l.id, materialId: l.materialId, code: l.material.code, description: l.material.description, spec: l.material.spec, unit: l.material.unit, orderedQty: l.orderedQty, receivedQty: l.receivedQty, unitPrice: l.unitPrice }));
  return {
    id: p.id, number: p.number, state: poState(lines, p.status === "CANCELLED"), currency: p.currency, supplier: p.supplier, project: p.project,
    orderDate: dateToIso(p.orderDate), expectedDate: i2(p.expectedDate), paymentTerms: p.paymentTerms, notes: p.notes, createdByName: p.createdByName,
    total: poTotal(lines), lines, receipts: p._count.receipts,
  };
}

export async function listPurchaseOrders(filter: { projectId?: string } = {}): Promise<PurchaseOrderDTO[]> {
  const rows = await prisma.purchaseOrder.findMany({ where: filter.projectId ? { projectId: filter.projectId } : {}, include: poInclude, orderBy: [{ orderDate: "desc" }, { number: "desc" }] });
  return rows.map(toDto);
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDTO | null> {
  const p = await loadPo(id);
  return p ? toDto(p) : null;
}

/** The project's materials that still have something left to order. */
export async function getToOrder(projectId: string) {
  const mats = await prisma.planMaterial.findMany({ where: { projectId }, include: { orders: { select: { orderedQty: true } } }, orderBy: { sortOrder: "asc" } });
  return mats
    .map((m) => ({ materialId: m.id, code: m.code, description: m.description, spec: m.spec, unit: m.unit, requiredQty: m.requiredQty, ordered: m.orders.reduce((s, o) => s + o.orderedQty, 0), remaining: remainingToOrder(m.requiredQty, m.orders) }))
    .filter((m) => m.remaining > 0);
}

async function numbered<T>(prefix: "PO" | "GR", create: (number: string) => Promise<T>): Promise<T> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 4; attempt++) {
    const where = { number: { startsWith: `${prefix}-${year}-` } };
    const rows: { number: string }[] = prefix === "PO"
      ? await prisma.purchaseOrder.findMany({ where, select: { number: true } })
      : await prisma.goodsReceipt.findMany({ where, select: { number: true } });
    const number = docNumber(prefix, year, nextSequence(rows.map((r) => r.number), prefix, year));
    try { return await create(number); } catch (e) { if (!isUnique(e) || attempt === 3) throw e; }
  }
  throw new PlanningError("Could not allocate a document number", 500);
}

export async function createPurchaseOrder(input: PurchaseOrderInput, by: Actor): Promise<PurchaseOrderDTO> {
  const [project, supplier, mats] = await Promise.all([
    prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } }),
    prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, active: true } }),
    prisma.planMaterial.findMany({ where: { projectId: input.projectId }, select: { id: true } }),
  ]);
  if (!project) throw new PlanningError("Project not found", 404);
  if (!supplier) throw new PlanningError("Supplier not found", 404);
  if (!supplier.active) throw new PlanningError("This supplier is inactive", 409);
  const bad = validatePoLines(input.lines, new Set(mats.map((m) => m.id)));
  if (bad) throw new PlanningError(bad);

  const orderDate = isoToDate(input.orderDate);
  const expectedDate = input.expectedDate ? isoToDate(input.expectedDate) : null;
  const po = await numbered<{ id: string; number: string }>("PO", (number) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: { number, currency: input.currency, orderDate, expectedDate, paymentTerms: input.paymentTerms, notes: input.notes, createdById: by.id, createdByName: by.name, projectId: input.projectId, supplierId: input.supplierId },
      });
      await tx.planMaterialOrder.createMany({
        data: input.lines.map((l) => ({ materialId: l.materialId, supplier: supplier.name, poNumber: number, orderedQty: l.qty, unitPrice: l.unitPrice ?? null, orderDate, expectedDate, purchaseOrderId: created.id })),
      });
      return created;
    }),
  );
  await logActivity({ userId: by.id, action: "CREATE", entity: "PURCHASE_ORDER", entityId: po.id, detail: `${po.number} — ${supplier.name}` });
  return (await getPurchaseOrder(po.id))!;
}

/** An order can be edited (supplier, dates, terms, quantities, prices, removing lines) until something is received against it. */
export async function updatePurchaseOrder(id: string, input: PurchaseOrderUpdateInput, by: Actor): Promise<PurchaseOrderDTO> {
  const p = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true, _count: { select: { receipts: true } } } });
  if (!p) throw new PlanningError("Purchase order not found", 404);
  if (p.status === "CANCELLED") throw new PlanningError("This purchase order is cancelled", 409);
  if (p._count.receipts > 0 || p.lines.some((l) => l.receivedQty > 0)) throw new PlanningError("Goods were already received against this purchase order, so it can no longer be edited.", 409);
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, active: true } });
  if (!supplier) throw new PlanningError("Supplier not found", 404);
  if (!supplier.active && supplier.id !== p.supplierId) throw new PlanningError("This supplier is inactive", 409);
  const own = new Set(p.lines.map((l) => l.id));
  const existing = input.lines.filter((l) => l.id) as { id: string; qty: number; unitPrice?: number | null }[];
  const added = input.lines.filter((l) => l.materialId) as { materialId: string; qty: number; unitPrice?: number | null }[];
  const customs = input.lines.filter((l) => l.custom) as { custom: { description: string; spec: string | null; unit: string }; qty: number; unitPrice?: number | null }[];
  const ids = existing.map((l) => l.id);
  if (ids.some((x) => !own.has(x))) throw new PlanningError("A line does not belong to this purchase order", 400);
  if (new Set(ids).size !== ids.length) throw new PlanningError("A line is listed twice", 400);
  if (added.length) {
    const mats = await prisma.planMaterial.findMany({ where: { projectId: p.projectId }, select: { id: true } });
    const bad = validatePoLines(added, new Set(mats.map((m) => m.id)));
    if (bad) throw new PlanningError(bad);
  }

  const orderDate = isoToDate(input.orderDate);
  const expectedDate = input.expectedDate ? isoToDate(input.expectedDate) : null;
  await prisma.$transaction(async (tx) => {
    await tx.planMaterialOrder.deleteMany({ where: { purchaseOrderId: id, id: { notIn: ids } } });
    await tx.purchaseOrder.update({ where: { id }, data: { supplierId: supplier.id, orderDate, expectedDate, paymentTerms: input.paymentTerms, notes: input.notes } });
    for (const l of existing) await tx.planMaterialOrder.update({ where: { id: l.id }, data: { orderedQty: l.qty, unitPrice: l.unitPrice ?? null, supplier: supplier.name, orderDate, expectedDate } });
    // a free item typed in while editing becomes a material of the project (so it shows in Materials and can be received)
    const base = await tx.planMaterial.count({ where: { projectId: p.projectId } });
    const created: { materialId: string; qty: number; unitPrice?: number | null }[] = [];
    for (const [i, c] of customs.entries()) {
      const m = await tx.planMaterial.create({ data: { description: c.custom.description, spec: c.custom.spec, unit: c.custom.unit, requiredQty: c.qty, sortOrder: base + i, projectId: p.projectId, createdById: by.id } });
      created.push({ materialId: m.id, qty: c.qty, unitPrice: c.unitPrice });
    }
    const all = [...added, ...created];
    if (all.length) await tx.planMaterialOrder.createMany({ data: all.map((l) => ({ materialId: l.materialId, supplier: supplier.name, poNumber: p.number, orderedQty: l.qty, unitPrice: l.unitPrice ?? null, orderDate, expectedDate, purchaseOrderId: id })) });
  });
  await logActivity({ userId: by.id, action: "UPDATE", entity: "PURCHASE_ORDER", entityId: id, detail: `${p.number} edited` });
  return (await getPurchaseOrder(id))!;
}

/** Cancelling is only possible while nothing has been received; the order lines are removed from Materials. */
export async function cancelPurchaseOrder(id: string, userId: string) {
  const p = await prisma.purchaseOrder.findUnique({ where: { id }, include: { _count: { select: { receipts: true } } } });
  if (!p) throw new PlanningError("Purchase order not found", 404);
  if (p.status === "CANCELLED") throw new PlanningError("This purchase order is already cancelled", 409);
  if (p._count.receipts > 0) throw new PlanningError("Goods were already received against this purchase order, so it cannot be cancelled.", 409);
  await prisma.$transaction([
    prisma.planMaterialOrder.deleteMany({ where: { purchaseOrderId: id } }),
    prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } }),
  ]);
  await logActivity({ userId, action: "UPDATE", entity: "PURCHASE_ORDER", entityId: id, detail: `${p.number} cancelled` });
}

// ------------------------------------------------------------------------------------ goods receipts

export interface ReceiptDTO {
  id: string; number: string; receivedDate: string; deliveryNote: string | null; notes: string | null; receivedByName: string;
  purchaseOrder: { id: string; number: string; supplier: string; project: string };
  lines: { id: string; description: string; spec: string | null; unit: string; qty: number; accepted: boolean; heatNo: string | null; certificateRef: string | null; notes: string | null }[];
}

export async function createGoodsReceipt(purchaseOrderId: string, input: ReceiptInput, by: Actor): Promise<ReceiptDTO> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { lines: { select: { id: true, orderedQty: true, receivedQty: true } } } });
  if (!po) throw new PlanningError("Purchase order not found", 404);
  if (po.status === "CANCELLED") throw new PlanningError("This purchase order is cancelled", 409);
  const bad = validateReceipt(input.lines, new Map(po.lines.map((l) => [l.id, { orderedQty: l.orderedQty, receivedQty: l.receivedQty }])));
  if (bad) throw new PlanningError(bad, 409);

  const receivedDate = isoToDate(input.receivedDate);
  const receipt = await numbered<{ id: string; number: string }>("GR", (number) =>
    prisma.$transaction(async (tx) => {
      const r = await tx.goodsReceipt.create({
        data: {
          number, receivedDate, deliveryNote: input.deliveryNote, notes: input.notes, receivedByName: by.name, createdById: by.id, purchaseOrderId,
          lines: { create: input.lines.map((l) => ({ orderId: l.orderId, qty: l.qty, accepted: l.accepted, heatNo: l.heatNo, certificateRef: l.certificateRef, notes: l.notes })) },
        },
      });
      for (const l of input.lines) {
        if (l.accepted) await tx.planMaterialOrder.update({ where: { id: l.orderId }, data: { receivedQty: { increment: l.qty }, receivedDate } });
      }
      return r;
    }),
  );
  await logActivity({ userId: by.id, action: "CREATE", entity: "GOODS_RECEIPT", entityId: receipt.id, detail: `${receipt.number} for ${po.number}` });
  return (await listReceipts({ id: receipt.id }))[0];
}

export async function listReceipts(filter: { id?: string; purchaseOrderId?: string; projectId?: string; heatNo?: string } = {}): Promise<ReceiptDTO[]> {
  const heat = filter.heatNo?.trim();
  const rows = await prisma.goodsReceipt.findMany({
    where: {
      ...(filter.id ? { id: filter.id } : {}),
      ...(filter.purchaseOrderId ? { purchaseOrderId: filter.purchaseOrderId } : {}),
      ...(filter.projectId ? { purchaseOrder: { projectId: filter.projectId } } : {}),
      ...(heat ? { lines: { some: { heatNo: { contains: heat, mode: "insensitive" as const } } } } : {}),
    },
    include: {
      purchaseOrder: { select: { id: true, number: true, supplier: { select: { name: true } }, project: { select: { number: true } } } },
      lines: { include: { order: { select: { material: { select: { description: true, spec: true, unit: true } } } } }, orderBy: { id: "asc" } },
    },
    orderBy: [{ receivedDate: "desc" }, { number: "desc" }],
    take: 300,
  });
  return rows.map((r) => ({
    id: r.id, number: r.number, receivedDate: dateToIso(r.receivedDate), deliveryNote: r.deliveryNote, notes: r.notes, receivedByName: r.receivedByName,
    purchaseOrder: { id: r.purchaseOrder.id, number: r.purchaseOrder.number, supplier: r.purchaseOrder.supplier.name, project: r.purchaseOrder.project.number },
    lines: r.lines.map((l) => ({ id: l.id, description: l.order.material.description, spec: l.order.material.spec, unit: l.order.material.unit, qty: l.qty, accepted: l.accepted, heatNo: l.heatNo, certificateRef: l.certificateRef, notes: l.notes })),
  }));
}
