import { prisma } from "@/server/db/client";
import type { ProjectInput } from "@/server/validators/project";
import { logActivity } from "./activity-log.service";

export async function listProjects() {
  return prisma.project.findMany({
    include: { customer: true, createdBy: { select: { name: true } }, _count: { select: { documents: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProject(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { name: true, email: true } },
      documents: { orderBy: { uploadDate: "desc" }, include: { uploadedBy: { select: { name: true } } } },
    },
  });
}

export async function createProject(data: ProjectInput, userId: string) {
  const project = await prisma.project.create({
    data: {
      number: data.number,
      name: data.name,
      customerId: data.customerId,
      description: data.description || null,
      stage: data.stage,
      status: data.status,
      revision: data.revision,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      createdById: userId,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "PROJECT", entityId: project.id, detail: project.number });
  return project;
}

export async function updateProject(id: string, data: ProjectInput, userId: string) {
  const project = await prisma.project.update({
    where: { id },
    data: {
      number: data.number,
      name: data.name,
      customerId: data.customerId,
      description: data.description || null,
      stage: data.stage,
      status: data.status,
      revision: data.revision,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
    },
  });
  await logActivity({ userId, action: "UPDATE", entity: "PROJECT", entityId: project.id, detail: project.number });
  return project;
}

export async function deleteProject(id: string, userId: string) {
  const project = await prisma.project.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "PROJECT", entityId: id, detail: project.number });
  return project;
}

export async function projectStats() {
  const [total, tendering, inProgress, onHold, completed, submitted, archived] = await Promise.all([
    prisma.project.count(),
    prisma.project.count({ where: { stage: "TENDERING" } }),
    prisma.project.count({ where: { status: "IN_PROGRESS" } }),
    prisma.project.count({ where: { status: "ON_HOLD" } }),
    prisma.project.count({ where: { status: "COMPLETED" } }),
    prisma.project.count({ where: { status: "SUBMITTED" } }),
    prisma.project.count({ where: { status: "ARCHIVED" } }),
  ]);
  return { total, tendering, inProgress, onHold, completed, submitted, archived };
}
