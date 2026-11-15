import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError } from "./planning.service";
import type { SupplierInput } from "@/server/validators/procurement";

export interface SupplierDTO {
  id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null;
  active: boolean; orders: number;
}

const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

export async function listSuppliers(): Promise<SupplierDTO[]> {
  const rows = await prisma.supplier.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { orders: true } } } });
  return rows.map((s) => ({ id: s.id, name: s.name, contactName: s.contactName, phone: s.phone, email: s.email, address: s.address, notes: s.notes, active: s.active, orders: s._count.orders }));
}

export async function createSupplier(input: SupplierInput, userId: string) {
  try {
    const s = await prisma.supplier.create({ data: { name: input.name, contactName: input.contactName, phone: input.phone, email: input.email, address: input.address, notes: input.notes, active: input.active ?? true } });
    await logActivity({ userId, action: "CREATE", entity: "SUPPLIER", entityId: s.id, detail: s.name });
    return s;
  } catch (e) {
    if (isUnique(e)) throw new PlanningError("A supplier with this name already exists", 409);
    throw e;
  }
}

export async function updateSupplier(id: string, input: SupplierInput, userId: string) {
  try {
    const s = await prisma.supplier.update({ where: { id }, data: { name: input.name, contactName: input.contactName, phone: input.phone, email: input.email, address: input.address, notes: input.notes, ...(input.active === undefined ? {} : { active: input.active }) } });
    await logActivity({ userId, action: "UPDATE", entity: "SUPPLIER", entityId: s.id, detail: s.name });
    return s;
  } catch (e) {
    if (isUnique(e)) throw new PlanningError("A supplier with this name already exists", 409);
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2025") throw new PlanningError("Supplier not found", 404);
    throw e;
  }
}

/** A supplier with purchase orders is kept (deactivate it instead) so the orders keep their history. */
export async function deleteSupplier(id: string, userId: string) {
  const s = await prisma.supplier.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
  if (!s) throw new PlanningError("Supplier not found", 404);
  if (s._count.orders > 0) throw new PlanningError("This supplier has purchase orders. Deactivate it instead of deleting it.", 409);
  await prisma.supplier.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "SUPPLIER", entityId: id, detail: s.name });
}
