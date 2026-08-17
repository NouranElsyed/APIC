import { prisma } from "@/server/db/client";
import type { CustomerInput } from "@/server/validators/customer";
import { logActivity } from "./activity-log.service";

export async function listCustomers() {
  return prisma.customer.findMany({
    include: { _count: { select: { projects: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCustomer(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: { projects: { orderBy: { createdAt: "desc" } } },
  });
}

export async function createCustomer(data: CustomerInput, userId: string) {
  const customer = await prisma.customer.create({
    data: {
      code: data.code,
      name: data.name,
      contact: data.contact || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      taxNumber: data.taxNumber || null,
      notes: data.notes || null,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "CUSTOMER", entityId: customer.id, detail: customer.name });
  return customer;
}

export async function updateCustomer(id: string, data: CustomerInput, userId: string) {
  const customer = await prisma.customer.update({
    where: { id },
    data: {
      code: data.code,
      name: data.name,
      contact: data.contact || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      taxNumber: data.taxNumber || null,
      notes: data.notes || null,
    },
  });
  await logActivity({ userId, action: "UPDATE", entity: "CUSTOMER", entityId: customer.id, detail: customer.name });
  return customer;
}

export async function deleteCustomer(id: string, userId: string) {
  const customer = await prisma.customer.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "CUSTOMER", entityId: id, detail: customer.name });
  return customer;
}
